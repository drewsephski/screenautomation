# Playwright + Chromium are a matched, immutable release. Register the built
# image as a versioned Daytona snapshot; do not reuse the snapshot name.
FROM mcr.microsoft.com/playwright:v1.64.1-noble@sha256:47b510dd9230bf0b9bfc9b20102241e577ea7a99334ab4c3ca19f19770e9b8ea
USER root
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ffmpeg fonts-dejavu-core fonts-liberation fonts-noto-core xvfb xfce4 xfce4-terminal \
    x11vnc novnc dbus-x11 x11-xserver-utils locales \
    && locale-gen en_US.UTF-8 && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/capture
RUN npm init -y && npm install --save-exact playwright@1.64.1 && \
    dpkg-query -W > /opt/capture/system-packages.txt && \
    fc-list | sort > /opt/capture/fonts.txt
ENV DISPLAY=:0 VNC_RESOLUTION=1920x1080 LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 TZ=UTC PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
