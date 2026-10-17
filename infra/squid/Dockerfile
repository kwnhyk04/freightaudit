# The public demo's egress proxy (infra/squid.conf, docs/deploy.md): Ubuntu's squid from noble-security, nothing else.
# Build from the repository root: docker build -f infra/squid/Dockerfile .
# The newest build is installed, not an exact version: Ubuntu drops superseded builds from its archive. The build fails on
# anything older than the release with the 2026 ICP, FTP gateway and cache digest fixes; a new base digest from
# Dependabot rebuilds it with the newest fixes.
FROM ubuntu:24.04@sha256:68ee22004a9109b44973313b02ff7b1de250f1de0f5ecb628d73f579aaff33ac
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
