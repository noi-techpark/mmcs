FROM node:22-alpine AS frontend-build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/. .
RUN npm run build

FROM golang:1.26-alpine AS backend-build
WORKDIR /app
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/. .
RUN CGO_ENABLED=0 GOOS=linux go build -o open-mmc .

# main.go serves the SPA straight off ./static next to the binary when the
# directory exists, so bundling both into one image gives a single
# deployable service instead of a frontend/backend pair to wire together.
FROM alpine:latest
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=backend-build /app/open-mmc .
COPY --from=frontend-build /app/dist ./static
ENV ADDR=":8080"
EXPOSE 8080
ENTRYPOINT [ "./open-mmc" ]
