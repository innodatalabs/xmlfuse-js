all: bld

test:
	npm run test

bld: test
	npm run build

clean:
	rm -rf build/