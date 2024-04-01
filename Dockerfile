FROM rust:1.77 as builder
WORKDIR /usr/src/openvscode-farm
COPY . .
RUN cargo install --path .

FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y \
  ca-certificates \
  curl \
  gnupg \
  lsb-release \
  --no-install-recommends && \
  curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg && \
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/debian $(lsb_release -cs) stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null && \
  apt-get update && \
  apt-get install -y docker-ce-cli && \
  apt-get clean && \
  rm -rf /var/lib/apt/lists/*

COPY --from=builder /usr/local/cargo/bin/openvscode-farm /usr/local/bin/openvscode-farm
CMD ["openvscode-farm"]