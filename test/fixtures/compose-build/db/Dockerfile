ARG PG_TAG=18-3.6
FROM postgis/postgis:${PG_TAG}
COPY init.sql /docker-entrypoint-initdb.d/
