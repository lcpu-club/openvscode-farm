FROM openvscode-server-base:latest

ENV OPENVSCODE_SERVER_ROOT="/home/.openvscode-server"
ENV OPENVSCODE="${OPENVSCODE_SERVER_ROOT}/bin/openvscode-server"
SHELL ["/bin/bash", "-c"]
RUN exts=(rust-lang.rust-analyzer) \
  && for ext in "${exts[@]}"; do ${OPENVSCODE} --install-extension "${ext}"; done
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
