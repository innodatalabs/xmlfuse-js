all: lint test build

lint:
	npm run lint

test: lint
	npm run test

build:
	npm run build
