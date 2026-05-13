FROM node:20-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY . .

RUN ls -R src/components

RUN npm run build

FROM nginx:alpine AS run

RUN apk add --no-cache curl

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]