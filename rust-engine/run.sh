#!/bin/bash
# HSMC Rust Engine — build & run script
# Requires: Rust toolchain, ~2GB free disk for target/
# If the sandbox disk is full, run: rm -rf target
set -e
cd "$(dirname "$0")"
rm -rf target
echo "=== Building ===" && cargo build && echo "=== Testing ===" && cargo test && echo "=== Starting on 0.0.0.0:8002 ===" && cargo run
