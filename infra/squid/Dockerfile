# The public demo's egress proxy (infra/squid.conf, docs/deploy.md): Ubuntu's squid from noble-security, nothing else.
# Build from the repository root: docker build -f infra/squid/Dockerfile .
# The newest build is installed, not an exact version: Ubuntu drops superseded builds from its archive. The build fails on
# anything older than the release with the 2026 ICP, FTP gateway and cache digest fixes; a new base digest from
# Dependabot rebuilds it with the newest fixes.
FROM ubuntu:24.10@sha256:cdf755952ed117f6126ff4e65810bf93767d4c38f5c7185b50ec1f1078b464cc
ARG SQUID_MIN=6.14-0ubuntu0.24.04.4
RUN apt-get update \
  && apt-get install -y --no-install-recommends -t noble-security squid \
  && rm -rf /var/lib/apt/lists/* \
  && version="$(dpkg-query -W -f='${Version}' squid)" \
  && echo "squid ${version} (minimum ${SQUID_MIN})" \
  && dpkg --compare-versions "${version}" ge "${SQUID_MIN}"
USER proxy
EXPOSE 3128 3129
ENTRYPOINT ["squid", "-N", "-f", "/etc/squid/squid.conf"]
