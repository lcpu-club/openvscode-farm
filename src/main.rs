use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use clap::Parser;
use log::error;
use rand::distributions::Alphanumeric;
use rand::Rng;
use std::{net::SocketAddr, path::Path, str::FromStr, sync::Arc};
use tokio::process::Command;
use warp::{reject::Rejection, reply::Reply, Filter};

#[derive(Parser, Debug)]
#[command(version, about, long_about = None)]
struct Cli {
    /// Sets a custom config file
    #[arg(short, long, env)]
    listen: Option<String>,

    /// Container URL template
    #[arg(short, long, env)]
    container_url: Option<String>,

    /// Data directory
    #[arg(short, long, env)]
    data_dir: Option<String>,
}

#[derive(Debug)]
struct InvalidAccessToken;
impl warp::reject::Reject for InvalidAccessToken {}

fn parse_access_token(token: &String) -> Result<String, Rejection> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 {
        return Err(warp::reject::custom(InvalidAccessToken));
    }
    let payload = parts[1];
    let decoded = URL_SAFE_NO_PAD
        .decode(payload)
        .map_err(|_| warp::reject::custom(InvalidAccessToken))?;
    let decoded =
        String::from_utf8(decoded).map_err(|_| warp::reject::custom(InvalidAccessToken))?;
    let decoded: serde_json::Value =
        serde_json::from_str(&decoded).map_err(|_| warp::reject::custom(InvalidAccessToken))?;
    let user_id = decoded["userId"]
        .as_str()
        .ok_or(warp::reject::custom(InvalidAccessToken))?;
    Ok(user_id.to_string())
}

fn generate_secret_token() -> String {
    let rand_string: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(32)
        .map(char::from)
        .collect();
    rand_string
}

fn get_routes<'a>(args: &Cli) -> impl Filter<Extract = impl Reply, Error = Rejection> + Clone {
    let container_url = Arc::new(
        args.container_url
            .to_owned()
            .unwrap_or("http://localhost:{port}/?tkn={token}".to_string()),
    );
    let data_dir = Arc::new(
        args.data_dir
            .to_owned()
            .unwrap_or("/opt/vscs-farm".to_string()),
    );

    let start = warp::path!("start")
        .and(warp::get())
        .and(warp::header::<String>("X-Forwarded-Access-Token"))
        .and_then(move |access_token: String| {
            let container_url = container_url.clone();
            let data_dir = data_dir.clone();
            async move {
                let user_id = parse_access_token(&access_token)?;
                let user_data_dir = Path::new(data_dir.as_ref()).join(&user_id);
                let user_data_dir = user_data_dir.to_str().unwrap();
                // Use user_id to create a unique container name
                Command::new("docker")
                    .arg("run")
                    .arg("-d")
                    .arg("--rm")
                    .arg("--name")
                    .arg(format!("vscs-{}", user_id))
                    .arg("--init")
                    .arg("--entrypoint")
                    .arg("")
                    .arg("-p")
                    .arg("3000")
                    .arg("-v")
                    .arg(format!(
                        "{}:/home/workspace:z,cached",
                        user_data_dir
                    ))
                    .arg("gitpod/openvscode-server")
                    .arg("sh")
                    .arg("-c")
                    .arg("exec ${OPENVSCODE_SERVER_ROOT}/bin/openvscode-server \"${@}\"")
                    .arg("--")
                    .arg("--connection-token")
                    .arg(generate_secret_token())
                    .arg("--host")
                    .arg("0.0.0.0")
                    .arg("--enable-remote-auto-shutdown")
                    .output()
                    .await
                    .map_err(|e| {
                        error!("Failed to start container: {}", e);
                        warp::reject::reject()
                    })?;
                // Now, use docker inspect to get the container port and secret
                // docker inspect -f '{{(index (index .NetworkSettings.Ports "3000/tcp") 0).HostPort}}' vscs-<user_id>
                let output = Command::new("docker")
                    .arg("inspect")
                    .arg(format!("vscs-{}", user_id))
                    .arg("-f")
                    .arg("{{(index (index .NetworkSettings.Ports \"3000/tcp\") 0).HostPort}} {{ index (index .Config.Cmd) 5 }}")
                    .output()
                    .await
                    .map_err(|e| {
                        error!("Failed to inspect container: {}", e);
                        warp::reject::reject()
                    })?;
                let output = String::from_utf8(output.stdout).map_err(|e| {
                    error!("Failed to parse inspect output: {}", e);
                    warp::reject::reject()
                })?;
                let parts: Vec<&str> = output.trim().split(' ').collect();
                if parts.len() != 2 {
                    return Err(warp::reject::reject());
                }
                let port = parts[0];
                let secret = parts[1];
                let url = container_url
                    .replace("{port}", port)
                    .replace("{token}", secret);
                let url = warp::http::Uri::from_str(&url).map_err(|e| {
                    error!("Failed to parse URL: {}", e);
                    warp::reject::reject()
                })?;
                Ok::<_, Rejection>(warp::redirect::found(url))
            }
        });

    let stop = warp::path!("stop").and(warp::post()).and_then(|| async {
        // Use user_id to stop the container
        Command::new("docker")
            .arg("stop")
            .arg(format!("vscs-{}", "user_id"))
            .output()
            .await
            .map_err(|e| {
                error!("Failed to stop container: {}", e);
                warp::reject::reject()
            })?;
        Ok::<_, Rejection>("")
    });
    let routes = start.or(stop);
    routes
}

#[tokio::main]
async fn main() {
    pretty_env_logger::init();

    let args = &Cli::parse();
    let listen: SocketAddr = args
        .listen
        .to_owned()
        .unwrap_or("127.0.0.1:3030".to_string())
        .parse()
        .expect("Invalid listen address");
    error!("Listening on: {}", listen);
    warp::serve(get_routes(args)).run(listen).await;
}
