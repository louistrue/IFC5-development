# Prototype IFC5 USD Viewer

This folder contains a proof-of-concept for converting IFC5 `.ifcx` files to USD format and
viewing the result with Three.js using the TinyUSDZ loader.

## Usage

1. Convert an `.ifcx` file to `.usda`:

```sh
node convert.js "../Hello Wall/hello-wall.ifcx" hellowall.usda
```

Package the resulting `hellowall.usda` into a `hellowall.usdz` archive and place it
next to `index.html` (not included here).

2. Open `public/index.html` in a browser with a local server to load the USDZ file.

The viewer relies on TinyUSDZ's experimental `TinyUSDZLoader` which is not
included in this repository. Obtain it from the TinyUSDZ project and place the
loader script next to `index.html`.

## Tests

Run the tests with Node:

```sh
node test/convert.test.js
```

The tests verify that the conversion step outputs a basic USDA structure for the
Hello Wall example.
