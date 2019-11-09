# xmlfuse-js

[![Build Status](https://travis-ci.org/innodatalabs/xmlfuse-js.svg?branch=master)](https://travis-ci.org/innodatalabs/xmlfuse-js)
[![npm version](https://badge.fury.io/js/%40innodatalabs%2Fxmlfuse-js.svg)](https://badge.fury.io/js/%40innodatalabs%2Fxmlfuse-js)

XML representations as a JSON stream. Convenient for content-oriented XML tasks.

This is a JS port of Python package [xmlfuse](https://pypi.org/project/xmlfuse/).

## Installation

```
npm i @innodatalabs/xmlfuse-js --save
```

### Building and testing:
```
make
```

## API
```js
import { fromString, toString } from '@innodatalabs/lxmlx-js';
import { fuse } from '@innodatalabs/xmlfuse-js';

const xml1 = fromString('<span>Hello, <i>world!</i></span>');
const xml2 = fromString('<span><b>Hello</b>, world!</span>');

const xml = fuze(xml1, xml2)
toString(xml) === '<span><b>Hello</b>, <i>world!</i></span>'
// true
```

# Input documents must have exactly the same text
Error is raised if text differs. Whitespace does matter!

Example:
```js
const xml1 = fromString('<span>Hello</span>');
const xml2 = fromString('<span>Good bye</span>');

const xml = fuze(xml1, xml2);
// throws Error('Text is different')
```

# Conflicting markup
Sometimes it is not possible to merge two markups, because tags intersect. In such a case one has a choice:

  a. Raise an exception and let caller handle the problem
  b. Resolve by segmenting one of the markups

We treat first document as **master**, and second as **slave**. Master markup is never segmented. If there is a
conflict between master and slave markups (and if `autoSegment` option is `true`), `fuse()` will segment slave to make markup consistent.

Example:
```js
const xml1 = fromString('<span>Hel<i>lo, world!</i></span>');
const xml2 = fromString('<span><b>Hello</b>, world!</span>');

const xml = fuze(xml1, xml2);
toString(xml) === '<span><b>Hel<i>lo</i></b></i>, <i>world!</i></span>';
// true
```

Set `autoSegment` flag to `false` to prevent segmentation. Error will be raised instead, if conflict detected.

# Ambiguities
When master ans slave markups wrap the same text, there is a nesting ambuguity - which tag should be inner?

We resolve this by consistently trying to put **slave** markup inside the **master**. This behavior can be changed
by setting the flag `preferSlaveInner` to false.

Example:
```js
const xml1 = fromString('<span><i>Hello</i>, world!</span>');
const xml2 = fromString('<span><b>Hello</b>, world!</span>');

const xml = fuze(xml1, xml2, {preferSlaveInner: true});
toString(xml) === '<span><b><i>Hello</i></b>, world!</span>';
// true

const xml = fuze(xml1, xml2, {preferSlaveInner: false});
toString(xml) == b'<span><i><b>Hello</b></i>, world!</span>';
// true
```

# Slave top-level tag is dropped
Note that top-level tag from slave is not merged. It is just dropped. If you want it to be merged into the output,
set `stripSlaveTopTag: false`.

# fuse() signature

```js
function fuse(xml1, xml2, options) { ... }
```
Where:
* `xml1` is the master XML document (LXML Element object, see http://lxml.de)
* `xml2` is the slave XML document

Returns fused XML document

Recognized options:
* `preferSlaveInner` controls ambigiuty resolution
* `autoSegment` allows slave markup segmentation in case of conflicting markup
* `stripSlaveTopTag` allows `fuse` to ignore top-level tag from the slave XML
* `nsmap` provides namespace mapping for building the output document
   (see `lxmlx-js` doc for more details on namespaces)

