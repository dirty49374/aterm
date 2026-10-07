FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6

ARG VERSION
LABEL org.opencontainers.image.title="Aterm" \
      org.opencontainers.image.description="Persistent Aterm Workspace, Web UI, GraphQL and Streamable HTTP MCP" \
      org.opencontainers.image.version=$VERSION

COPY npm/ /tmp/npm/
RUN test -n "$VERSION" \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git tini \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --prefix /opt/aterm /tmp/npm/*.tgz \
         --registry https://registry.npmjs.org --omit=dev --no-audit --no-fund \
    && test "$(/opt/aterm/node_modules/.bin/aterm --version)" = "$VERSION" \
    && rm -rf /tmp/npm \
    && npm cache clean --force \
    && mkdir -p /data/.aterm/cache/semantic \
    && chown -R node:node /data

COPY bootstrap.mjs /opt/aterm/bootstrap.mjs
COPY entrypoint.sh /opt/aterm/entrypoint.sh
RUN chmod 755 /opt/aterm/entrypoint.sh

ENV NODE_ENV=production ATERM_HOME=/data/.aterm
WORKDIR /data
USER 1000:1000
EXPOSE 43127
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/bin/tini", "--", "/opt/aterm/entrypoint.sh"]
CMD ["server", "run", "--host", "0.0.0.0", "--port", "43127"]
