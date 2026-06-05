FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./

RUN npm ci --only=production

FROM node:20-alpine

RUN apk add --no-cache curl

WORKDIR /app/gateway

ENV NODE_ENV=production

COPY --from=builder --chown=node:node /app/node_modules ./node_modules

COPY --chown=node:node . .

USER node

EXPOSE 3000

CMD ["npm", "start"]