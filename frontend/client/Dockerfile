# Stage 1: Build
FROM node:20-alpine AS build

# Đặt thư mục làm việc gọn gàng
WORKDIR /app

# Chỉ copy file package trước để tận dụng cache của Docker
COPY package*.json ./
RUN npm install

# Copy toàn bộ code vào
COPY . .

# Kiểm tra lại một lần nữa xem file có ở đó không (Debug)
RUN ls -R src/components

# Build dự án (Vite sẽ tạo ra thư mục 'dist')
RUN npm run build

# Stage 2: Run
FROM nginx:alpine AS run

# Vite xuất ra 'dist', hãy copy đúng thư mục này
COPY --from=build /app/dist /usr/share/nginx/html

# Copy thêm file cấu hình nginx nếu bạn có (tùy chọn)
# COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]