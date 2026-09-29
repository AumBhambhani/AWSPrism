FROM node:24-alpine

WORKDIR /app

# Pull in OS security patches (libcrypto, libssl, etc.)
RUN apk update && apk upgrade --no-cache

# Upgrade npm itself so its bundled deps (tar, brace-expansion) are patched
RUN npm install -g npm@latest

COPY package*.json ./
RUN npm ci

COPY . .

RUN addgroup --system appgroup \
 && adduser --system --ingroup appgroup appuser \
 && chown -R appuser:appgroup /app

EXPOSE 5173

USER appuser
CMD ["npm", "run", "dev"]
