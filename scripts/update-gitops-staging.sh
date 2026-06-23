#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "Usage: $0 <gitops-repo-dir> <image-tag> [service...]" >&2
  exit 2
fi

GITOPS_DIR="$1"
IMAGE_TAG="$2"
shift 2
TARGET_FILE="$GITOPS_DIR/apps/dacn/staging/helmrelease.yaml"

if [ ! -f "$TARGET_FILE" ]; then
  echo "GitOps staging HelmRelease not found: $TARGET_FILE" >&2
  exit 1
fi

if [[ "$IMAGE_TAG" =~ [[:space:]] ]]; then
  echo "Image tag must not contain whitespace: $IMAGE_TAG" >&2
  exit 1
fi

if [ "$#" -eq 0 ]; then
  echo "No changed services were provided; staging image tags were not changed."
  exit 0
fi

update_service_tag() {
  local service="$1"

  case "$service" in
    auth|product|order|gateway|frontend) ;;
    nginx)
      echo "nginx image is not deployed by the staging HelmRelease; skipping GitOps tag update."
      return 0
      ;;
    *)
      echo "Unsupported service for staging image tag update: $service" >&2
      exit 2
      ;;
  esac

  export IMAGE_TAG SERVICE_NAME="$service"

  perl -e '
    use strict;
    use warnings;

    my $file = shift @ARGV;
    my $service = $ENV{SERVICE_NAME};
    my $tag = $ENV{IMAGE_TAG};

    open my $in, "<", $file or die "Cannot read $file: $!\n";
    local $/;
    my $content = <$in>;
    close $in;

    my $changed = ($content =~ s{
      ^([ ]{6}\Q$service\E:\n)
      (.*?)
      (?=^[ ]{6}\S|\z)
    }{
      my ($head, $body) = ($1, $2);

      if ($body =~ /^        image:\n/ms) {
        if ($body =~ /^          tag:\s*\S+/m) {
          $body =~ s/^          tag:\s*\S+/          tag: $tag/m;
        } else {
          $body =~ s/^(        image:\n)/$1          tag: $tag\n/m;
        }
      } else {
        $body = "        image:\n          tag: $tag\n" . $body;
      }

      $head . $body;
    }gemsx);

    if (!$changed) {
      die "Service block was not found in staging HelmRelease: $service\n";
    }

    open my $out, ">", $file or die "Cannot write $file: $!\n";
    print {$out} $content;
    close $out;
  ' "$TARGET_FILE"

  if ! perl -0ne '
    my $service = $ENV{SERVICE_NAME};
    my $tag = $ENV{IMAGE_TAG};
    $ok = 1 if /^      \Q$service\E:\n(?:(?!^      \S).)*^          tag:\s*\Q$tag\E\s*$/ms;
    END { exit($ok ? 0 : 1) }
  ' "$TARGET_FILE"; then
    echo "Failed to update $service image tag in $TARGET_FILE" >&2
    exit 1
  fi

  echo "Updated staging $service image tag to $IMAGE_TAG"
}

for service in "$@"; do
  update_service_tag "$service"
done
