FROM nginx:alpine

RUN apk add --no-cache curl

COPY nginx.conf /etc/nginx/nginx.conf

RUN rm -rf /etc/nginx/conf.d/*

COPY conf.d /etc/nginx/conf.d

EXPOSE 80