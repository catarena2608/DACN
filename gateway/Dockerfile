FROM node:18-alpine

RUN apk add --no-cache curl

WORKDIR /app/gateway

COPY package*.json .

RUN npm install

COPY . .

EXPOSE 3000

CMD ["npm", "start"]