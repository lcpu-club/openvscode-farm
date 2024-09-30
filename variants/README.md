# Variants

This directory contains the variant Open VS Code images.

## File Structure
- `base.dockerfile`: Used to build the base image.
- `rust.dockerfile`: Builds the Rust development environment image based on the base image.
- `Makefile`: Contains commands to build the images.

## Building the Base Image

The base image includes:
- Based on the `gitpod/openvscode-server:latest` image.
- Uses Peking University's Ubuntu 22.04 software source.
- Installs `build-essential` and `zsh`.
- Configures Oh My Zsh and the zzshell theme.
- Installs Node.js and npm.
- Installs some VSCode extensions.

To build the base image, run:

```sh
make base
```

## Building the Rust Image

The Rust image is based on the base image and includes:

- Installs the Rust toolchain.
- Installs the Rust Analyzer VSCode extension.

To build the Rust image, run:

```sh
make rust
```

## Usage Examples

### Running the Base Image

```sh
docker run -it openvscode-server-base
```

### Running the Rust Image

```sh
docker run -it openvscode-server-rust
```
