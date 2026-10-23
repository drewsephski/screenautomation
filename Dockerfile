FROM node:26.3.0-bookworm-slim
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN npm install --global pnpm@11.25.0
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @repo/worker bundle && pnpm --filter web build
ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "--filter", "web", "start"]
