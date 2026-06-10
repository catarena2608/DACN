#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <gitops-repo-dir> <image-tag>" >&2
  exit 2
fi

GITOPS_DIR="$1"
IMAGE_TAG="$2"
TARGET_FILE="$GITOPS_DIR/apps/dacn/staging/helmrelease.yaml"

if [ ! -f "$TARGET_FILE" ]; then
  echo "GitOps staging HelmRelease not found: $TARGET_FILE" >&2
  exit 1
fi

if [[ "$IMAGE_TAG" =~ [[:space:]] ]]; then
  echo "Image tag must not contain whitespace: $IMAGE_TAG" >&2
  exit 1
fi

export IMAGE_TAG

perl -0pi -e 's/(^[[:space:]]*imageTag:[[:space:]]*)\S+/${1}$ENV{IMAGE_TAG}/m' "$TARGET_FILE"

if ! grep -q "imageTag: $IMAGE_TAG" "$TARGET_FILE"; then
  echo "Failed to update imageTag in $TARGET_FILE" >&2
  exit 1
fi

echo "Updated staging imageTag to $IMAGE_TAG in $TARGET_FILE"
