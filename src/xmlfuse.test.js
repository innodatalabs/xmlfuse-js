import {
    textOffsets,
    segmentText,
    asTokenStream,
    fuse,
} from './xmlfuse.js';

import { fromString, toString, scan, unscan, ENTER, EXIT, TEXT } from '@innodatalabs/lxmlx-js';

test('textOffset', () => {
    const xml = fromString('<a>Hello, <i>bright</i> <b>world</b></a>');
    const offsets = textOffsets(scan(xml));

    expect(offsets).toStrictEqual(new Set([0, 7, 13, 14, 19]));
});

test('segmentText', () => {
    const xml = fromString('<a>Hello, <i>bright</i> <b>world</b></a>');

    const segments = [...segmentText(scan(xml), [0, 2, 8])].filter(x => x.type===TEXT).map(x=>x.text);
    expect(segments).toStrictEqual(['He', 'llo, ', 'b', 'right', ' ', 'world']);
});

test('segmentText (bug 01)', () => {
    const xml = fromString('<a>Hello, <i>world</i></a>');

    const segments = [...segmentText(scan(xml), [0, 5, 12, 7])].filter(x => x.type===TEXT).map(x=>x.text);
    expect(segments).toStrictEqual(['Hello', ', ', 'world']);
});

test('asTokenStream', () => {
    const xml = fromString('<a>Hello, <i><s>bright</s></i> <b>world</b></a>');
    const tokens = [...asTokenStream(scan(xml))];

    const a = {type: ENTER, tag: 'a', attrib: {}};
    const a_ = {type: EXIT, peer: a};

    const i = {type: ENTER, tag: 'i', attrib: {}};
    const i_ = {type: EXIT, peer: i};

    const s = {type: ENTER, tag: 's', attrib: {}};
    const s_ = {type: EXIT, peer: s};

    const b = {type: ENTER, tag: 'b', attrib: {}};
    const b_ = {type: EXIT, peer: b};

    expect(tokens).toStrictEqual([
        {prefix: [a], text: 'Hello, ', suffix: []},
        {prefix: [i, s], text: 'bright', suffix: [s_, i_]},
        {prefix: [], text: ' ', suffix: []},
        {prefix: [b], text: 'world', suffix: [b_, a_]},
    ])
});

test('asTokenStream (with SPOT material)', () => {
    const xml = fromString('<a>Hello, bright<br/> <b>world</b></a>');
    const tokens = [...asTokenStream(scan(xml))];

    const a = {type: ENTER, tag: 'a', attrib: {}};
    const a_ = {type: EXIT, peer: a};

    const b = {type: ENTER, tag: 'b', attrib: {}};
    const b_ = {type: EXIT, peer: b};

    const br = {type: ENTER, tag: 'br', attrib: {}};
    const br_ = {type: EXIT, peer: br};

    expect(tokens).toStrictEqual([
        {prefix: [a], text: 'Hello, bright', suffix: []},
        {prefix: [{type: 'spot', spot: [br, br_]}], text: ' ', suffix: []},
        {prefix: [b], text: 'world', suffix: [b_, a_]},
    ])
});

test('asTokenStream (bug)', () => {
    const xml = fromString('<a>Hello, <i>worl</i>d</a>');
    const tokens = [...asTokenStream(scan(xml))];

    const a = {type: ENTER, tag: 'a', attrib: {}};
    const a_ = {type: EXIT, peer: a};

    const i = {type: ENTER, tag: 'i', attrib: {}};
    const i_ = {type: EXIT, peer: i};

    expect(tokens).toStrictEqual([
        {prefix: [a], text: 'Hello, ', suffix: []},
        {prefix: [i], text: 'worl', suffix: [i_]},
        {prefix: [], text: 'd', suffix: [a_]},
    ])
});

test('fuse (smoke)', () => {
    const xml1 = fromString('<a><b>Hello</b>, world</a>');
    const xml2 = fromString('<a>Hello, <i>world</i></a>');

    const merged = fuse(xml1, xml2);
    const result = toString(merged);

    const model = '<a><b>Hello</b>, <i>world</i></a>';
    expect(result).toBe(model);
});

test('fuse (harder)', () => {
    const xml1 = fromString('<a><b>Hello, </b>world</a>');
    const xml2 = fromString('<a>Hello, <i>world</i></a>');

    const merged = fuse(xml1, xml2);
    const result = toString(merged);

    const model = '<a><b>Hello, </b><i>world</i></a>';
    expect(result).toBe(model);
});

test('fuse (test_07)', () => {
    const xml1 = fromString('<a><b>Hello, w</b>orld</a>');
    const xml2 = fromString('<a>Hello, <i>world</i></a>');

    const merged = fuse(xml1, xml2);
    const result = toString(merged);

    const model = '<a><b>Hello, <i>w</i></b><i>orld</i></a>';
    expect(result).toBe(model);
});

test('fuse (test_08)', () => {
    const xml1 = fromString('<a><b>Hello</b>, <b>world</b></a>');
    const xml2 = fromString('<a>Hello, <i>worl</i>d</a>');

    const merged = fuse(xml1, xml2);
    const result = toString(merged);

    const model = '<a><b>Hello</b>, <b><i>worl</i>d</b></a>';
    expect(result).toBe(model);
});

test('fuse (test_09)', () => {
    const xml1 = fromString('<a><b>Hello</b>, w<b>orld</b></a>');
    const xml2 = fromString('<a>Hello, <i>worl</i>d</a>');

    const merged = fuse(xml1, xml2);
    const result = toString(merged);

    const model = '<a><b>Hello</b>, <i>w</i><b><i>orl</i>d</b></a>';
    expect(result).toBe(model);
});

test('fuse (test_10)', () => {
    const xml1 = fromString('<a><b>Hello</b>,<br/> world</a>');
    const xml2 = fromString('<a>Hello, <i>world</i></a>');

    const merged = fuse(xml1, xml2);
    const result = toString(merged);

    const model = '<a><b>Hello</b>,<br/> <i>world</i></a>';
    expect(result).toBe(model);
});

test('fuse (test_11)', () => {
    const xml1 = fromString('<a><b>Hello</b>,<br/> world</a>');
    const xml2 = fromString('<a><br><img/></br>Hello, <i>world</i></a>');

    const merged = fuse(xml1, xml2);
    const result = toString(merged);

    const model = '<a><b><br><img/></br>Hello</b>,<br/> <i>world</i></a>';
    expect(result).toBe(model);
});

test('fuse (test_12)', () => {
    const xml1 = fromString('<a><b>Hello</b>,<br/> world</a>');
    const xml2 = fromString('<a><br><img/></br><i>Hello</i>, <i>world</i></a>');

    const merged = fuse(xml1, xml2, {preferSlaveInner: false});
    const result = toString(merged);

    const model = '<a><br><img/></br><i><b>Hello</b></i>,<br/> <i>world</i></a>';
    expect(result).toBe(model);
});

test('fuse (test_13)', () => {
    const xml1 = fromString('<a><b>Hello</b>, world</a>');
    const xml2 = fromString('<a>Hello,<?pi ?> <i>world</i></a>');

    const merged = fuse(xml1, xml2, {preferSlaveInner: false});
    const result = toString(merged);

    const model = '<a><b>Hello</b>,<?pi ?> <i>world</i></a>';
    expect(result).toBe(model);
});

test('fuse (test_14)', () => {
    const xml1 = fromString('<a><b>Hello</b>, world</a>');
    const xml2 = fromString('<a>Hello,<!-- Hey Jude! --> <i>world</i></a>');

    const merged = fuse(xml1, xml2, {preferSlaveInner: false});
    const result = toString(merged);

    const model = '<a><b>Hello</b>,<!-- Hey Jude! --> <i>world</i></a>';
    expect(result).toBe(model);
});

test('fuse (test_15)', () => {
    const xml1 = fromString('<a><b>12345</b>67890</a>');
    const xml2 = fromString('<a>123<i>4567890</i></a>');

    expect(() => fuse(xml1, xml2, {preferSlaveInner: false, autoSegment: false})).toThrow('Conflicting markup');
});

test('fuse (test_16)', () => {
    const xml1 = fromString('<a>Hello and Bye</a>');
    const xml2 = fromString('<a>Hello and Good bye!</a>');

    expect(() => fuse(xml1, xml2)).toThrow('Input documents have different text at offset 10:');
});

test('fuse (test_17)', () => {
    const xml1 = fromString('<a>Hello and</a>');
    const xml2 = fromString('<a>Hello and Good bye!</a>');

    expect(() => fuse(xml1, xml2)).toThrow('Master document has shorter text than the slave:');
});

test('fuse (test_18)', () => {
    const xml1 = fromString('<a>Hello and Good bye!</a>');
    const xml2 = fromString('<a>Hello and</a>');

    expect(() => fuse(xml1, xml2)).toThrow('Master document has longer text than the slave:');
});

