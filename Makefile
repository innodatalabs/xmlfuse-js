all: lint test

lint:
	npm run lint

test: lint
	npm run test
