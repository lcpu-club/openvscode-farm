base: base.dockerfile
	docker build -t openvscode-server-base -f base.dockerfile ..

rust: rust.dockerfile base
	docker build -t openvscode-server-rust -f rust.dockerfile ..
