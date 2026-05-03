FROM nginx:alpine

COPY nginx.conf /etc/nginx/nginx.conf

RUN rm -rf /etc/nginx/conf.d/*

COPY conf.d /etc/nginx/conf.d

EXPOSE 80