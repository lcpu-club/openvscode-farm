# OpenVSCode Farm

Run gitpod-io/openvscode-server for every user behind OAuth2.

## Usage

Create following configuration file:

```ini
# OAuth2 Proxy Settings
login_url=<login_url>
redeem_url=<redeem_url>
validate_url=<validate_url>
cookie_secret=<cookie_secret>
client_id=<client_id>
client_secret=<client_secret>
provider_display_name=<provider_display_name>
redirect_url=<redirect_url>
# OpenVSCode Server Data
data_dir=/home/thezzisu/Workspace/tmp
```

Then use `docker compose up` to spin up the server.

Access `http://server/start` to get your instance.
