import test from 'ava';
import {
    textOffsets,
    segmentText,
    asTokenStream,
    fuse,
    fuseEvents,
} from './index.mjs';
import {
    fromString,
    toString,
    scan,
    unscan,
    ENTER,
    EXIT,
    TEXT
} from '@innodatalabs/lxmlx-js';

test('textOffset', t => {
    const xml = fromString('<a>Hello, <i>bright</i> <b>world</b></a>');
    const offsets = textOffsets(scan(xml));

    t.deepEqual(offsets, new Set([0, 7, 13, 14, 19]));
});

test('segmentText', t => {
    const xml = fromString('<a>Hello, <i>bright</i> <b>world</b></a>');

    const segments = [...segmentText(scan(xml), [0, 2, 8])].filter(x => x.type===TEXT).map(x=>x.text);
    t.deepEqual(segments, ['He', 'llo, ', 'b', 'right', ' ', 'world']);
});

test('segmentText (bug 01)', t => {
    const xml = fromString('<a>Hello, <i>world</i></a>');

    const segments = [...segmentText(scan(xml), [0, 5, 12, 7])].filter(x => x.type===TEXT).map(x=>x.text);
    t.deepEqual(segments, ['Hello', ', ', 'world']);
});

test('asTokenStream', t => {
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

    t.deepEqual(tokens, [
        {prefix: [a], text: 'Hello, ', suffix: []},
        {prefix: [i, s], text: 'bright', suffix: [s_, i_]},
        {prefix: [], text: ' ', suffix: []},
        {prefix: [b], text: 'world', suffix: [b_, a_]},
    ]);
});

test('asTokenStream (with SPOT material)', t => {
    const xml = fromString('<a>Hello, bright<br/> <b>world</b></a>');
    const tokens = [...asTokenStream(scan(xml))];

    const a = {type: ENTER, tag: 'a', attrib: {}};
    const a_ = {type: EXIT, peer: a};

    const b = {type: ENTER, tag: 'b', attrib: {}};
    const b_ = {type: EXIT, peer: b};

    const br = {type: ENTER, tag: 'br', attrib: {}};
    const br_ = {type: EXIT, peer: br};

    t.deepEqual(tokens, [
        {prefix: [a], text: 'Hello, bright', suffix: []},
        {prefix: [{type: 'spot', spot: [br, br_]}], text: ' ', suffix: []},
        {prefix: [b], text: 'world', suffix: [b_, a_]},
    ]);
});

test('asTokenStream (bug)', t => {
    const xml = fromString('<a>Hello, <i>worl</i>d</a>');
    const tokens = [...asTokenStream(scan(xml))];

    const a = {type: ENTER, tag: 'a', attrib: {}};
    const a_ = {type: EXIT, peer: a};

    const i = {type: ENTER, tag: 'i', attrib: {}};
    const i_ = {type: EXIT, peer: i};

    t.deepEqual(tokens, [
        {prefix: [a], text: 'Hello, ', suffix: []},
        {prefix: [i], text: 'worl', suffix: [i_]},
        {prefix: [], text: 'd', suffix: [a_]},
    ]);
});

test('fuse (smoke)', t => {
    const xml1 = fromString('<a><b>Hello</b>, world</a>');
    const xml2 = fromString('<a>Hello, <i>world</i></a>');

    const merged = fuse(xml1, xml2);
    const result = toString(merged);

    const model = '<a><b>Hello</b>, <i>world</i></a>';
    t.is(result, model);
});

test('fuse (harder)', t => {
    const xml1 = fromString('<a><b>Hello, </b>world</a>');
    const xml2 = fromString('<a>Hello, <i>world</i></a>');

    const merged = fuse(xml1, xml2);
    const result = toString(merged);

    const model = '<a><b>Hello, </b><i>world</i></a>';
    t.is(result, model);
});

test('fuse (test_07)', t => {
    const xml1 = fromString('<a><b>Hello, w</b>orld</a>');
    const xml2 = fromString('<a>Hello, <i>world</i></a>');

    const merged = fuse(xml1, xml2);
    const result = toString(merged);

    const model = '<a><b>Hello, <i>w</i></b><i>orld</i></a>';
    t.is(result, model);
});

test('fuse (test_08)', t => {
    const xml1 = fromString('<a><b>Hello</b>, <b>world</b></a>');
    const xml2 = fromString('<a>Hello, <i>worl</i>d</a>');

    const merged = fuse(xml1, xml2);
    const result = toString(merged);

    const model = '<a><b>Hello</b>, <b><i>worl</i>d</b></a>';
    t.is(result, model);
});

test('fuse (test_09)', t => {
    const xml1 = fromString('<a><b>Hello</b>, w<b>orld</b></a>');
    const xml2 = fromString('<a>Hello, <i>worl</i>d</a>');

    const merged = fuse(xml1, xml2);
    const result = toString(merged);

    const model = '<a><b>Hello</b>, <i>w</i><b><i>orl</i>d</b></a>';
    t.is(result, model);
});

test('fuse (test_10)', t => {
    const xml1 = fromString('<a><b>Hello</b>,<br/> world</a>');
    const xml2 = fromString('<a>Hello, <i>world</i></a>');

    const merged = fuse(xml1, xml2);
    const result = toString(merged);

    const model = '<a><b>Hello</b>,<br/> <i>world</i></a>';
    t.is(result, model);
});

test('fuse (test_11)', t => {
    const xml1 = fromString('<a><b>Hello</b>,<br/> world</a>');
    const xml2 = fromString('<a><br><img/></br>Hello, <i>world</i></a>');

    const merged = fuse(xml1, xml2);
    const result = toString(merged);

    const model = '<a><b><br><img/></br>Hello</b>,<br/> <i>world</i></a>';
    t.is(result, model);
});

test('fuse (test_12)', t => {
    const xml1 = fromString('<a><b>Hello</b>,<br/> world</a>');
    const xml2 = fromString('<a><br><img/></br><i>Hello</i>, <i>world</i></a>');

    const merged = fuse(xml1, xml2, {preferSlaveInner: false});
    const result = toString(merged);

    const model = '<a><br><img/></br><i><b>Hello</b></i>,<br/> <i>world</i></a>';
    t.is(result, model);
});

test('fuse (test_13)', t => {
    const xml1 = fromString('<a><b>Hello</b>, world</a>');
    const xml2 = fromString('<a>Hello,<?pi ?> <i>world</i></a>');

    const merged = fuse(xml1, xml2, {preferSlaveInner: false});
    const result = toString(merged);

    const model = '<a><b>Hello</b>,<?pi ?> <i>world</i></a>';
    t.is(result, model);
});

test('fuse (test_14)', t => {
    const xml1 = fromString('<a><b>Hello</b>, world</a>');
    const xml2 = fromString('<a>Hello,<!-- Hey Jude! --> <i>world</i></a>');

    const merged = fuse(xml1, xml2, {preferSlaveInner: false});
    const result = toString(merged);

    const model = '<a><b>Hello</b>,<!-- Hey Jude! --> <i>world</i></a>';
    t.is(result, model);
});

test('fuse (test_15)', t => {
    const xml1 = fromString('<a><b>12345</b>67890</a>');
    const xml2 = fromString('<a>123<i>4567890</i></a>');

    t.throws(() => fuse(xml1, xml2, {preferSlaveInner: false, autoSegment: false}), /Conflicting markup/);
});

test('fuse (test_16)', t => {
    const xml1 = fromString('<a>Hello and Bye</a>');
    const xml2 = fromString('<a>Hello and Good bye!</a>');

    t.throws(() => fuse(xml1, xml2), /Input documents have different text at offset 10:/);
});

test('fuse (test_17)', t => {
    const xml1 = fromString('<a>Hello and</a>');
    const xml2 = fromString('<a>Hello and Good bye!</a>');

    t.throws(() => fuse(xml1, xml2), /Master document has shorter text than the slave:/);
});

test('fuse (test_18)', t => {
    const xml1 = fromString('<a>Hello and Good bye!</a>');
    const xml2 = fromString('<a>Hello and</a>');

    t.throws(() => fuse(xml1, xml2), /Master document has longer text than the slave:/);
});

test('fuseEvents bug', t => {
    const markup1 = [
      {
        "type": "text",
        "text": "ABDELLI, M."
      },
      {
        "type": "text",
        "text": ", "
      },
      {
        "type": "text",
        "text": "MOGHRANI, H."
      },
      {
        "type": "text",
        "text": ", "
      },
      {
        "type": "text",
        "text": "ABOUN, A."
      },
      {
        "type": "text",
        "text": " & "
      },
      {
        "type": "text",
        "text": "MAACHI, R."
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "type": "text",
        "text": "2016"
      },
      {
        "type": "text",
        "text": ". "
      },
      {
        "type": "text",
        "text": "Algerian "
      },
      {
        "type": "enter",
        "tag": "{http://www.thomsonreuters.com/science/journals}italic",
        "attrib": {}
      },
      {
        "type": "text",
        "text": "Mentha pulegium"
      },
      {
        "type": "exit"
      },
      {
        "type": "text",
        "text": " L. leaves essential oil: chemical composition, antimicrobial, insecticidal and antioxidant activities"
      },
      {
        "type": "text",
        "text": ". "
      },
      {
        "type": "enter",
        "tag": "{http://www.thomsonreuters.com/science/journals}italic",
        "attrib": {}
      },
      {
        "type": "text",
        "text": "Industrial Crops and Products"
      },
      {
        "type": "exit"
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "type": "enter",
        "tag": "{http://www.thomsonreuters.com/science/journals}bold",
        "attrib": {}
      },
      {
        "type": "text",
        "text": "94"
      },
      {
        "type": "text",
        "text": ": "
      },
      {
        "type": "text",
        "text": "197–"
      },
      {
        "type": "exit"
      },
      {
        "type": "text",
        "text": "205"
      },
      {
        "type": "text",
        "text": "."
      },
    ];

    const markup2 = [
      {
        "type": "enter",
        "tag": "{http://innodatalabs.com/brs}r",
        "attrib": {
          "id": "data000042:019"
        }
      },
      {
        "type": "enter",
        "tag": "{http://innodatalabs.com/brs}s",
        "attrib": {
          "l": "author-person"
        }
      },
      {
        "type": "text",
        "text": "ABDELLI"
      },
      {
        "type": "text",
        "text": ","
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "type": "text",
        "text": "M"
      },
      {
        "type": "text",
        "text": "."
      },
      {
        "type": "exit"
      },
      {
        "type": "text",
        "text": ","
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "type": "enter",
        "tag": "{http://innodatalabs.com/brs}s",
        "attrib": {
          "l": "author-person"
        }
      },
      {
        "type": "text",
        "text": "MOGHRANI"
      },
      {
        "type": "text",
        "text": ","
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "type": "text",
        "text": "H"
      },
      {
        "type": "text",
        "text": "."
      },
      {
        "type": "exit"
      },
      {
        "type": "text",
        "text": ","
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "type": "enter",
        "tag": "{http://innodatalabs.com/brs}s",
        "attrib": {
          "l": "author-person"
        }
      },
      {
        "type": "text",
        "text": "ABOUN"
      },
      {
        "type": "text",
        "text": ","
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "type": "text",
        "text": "A"
      },
      {
        "type": "text",
        "text": "."
      },
      {
        "type": "exit"
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "type": "text",
        "text": "&"
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "type": "enter",
        "tag": "{http://innodatalabs.com/brs}s",
        "attrib": {
          "l": "author-person"
        }
      },
      {
        "type": "text",
        "text": "MAACHI"
      },
      {
        "type": "text",
        "text": ","
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "type": "text",
        "text": "R"
      },
      {
        "type": "text",
        "text": "."
      },
      {
        "type": "exit"
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "type": "enter",
        "tag": "{http://innodatalabs.com/brs}s",
        "attrib": {
          "l": "publicationyear"
        }
      },
      {
        "type": "text",
        "text": "2016"
      },
      {
        "type": "exit"
      },
      {
        "type": "text",
        "text": "."
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "type": "enter",
        "tag": "{http://innodatalabs.com/brs}s",
        "attrib": {
          "l": "titletext"
        }
      },
      {
        "type": "text",
        "text": "Algerian"
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "type": "text",
        "text": "Mentha"
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "type": "text",
        "text": "pulegium"
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "type": "text",
        "text": "L"
      },
      {
        "type": "text",
        "text": "."
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "type": "text",
        "text": "leaves"
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "type": "text",
        "text": "essential"
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "type": "text",
        "text": "oil"
      },
      {
        "type": "text",
        "text": ":"
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "type": "text",
        "text": "chemical"
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "type": "text",
        "text": "composition"
      },
      {
        "type": "text",
        "text": ","
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "type": "text",
        "text": "antimicrobial"
      },
      {
        "type": "text",
        "text": ","
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "type": "text",
        "text": "insecticidal"
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "type": "text",
        "text": "and"
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "type": "text",
        "text": "antioxidant"
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "type": "text",
        "text": "activities"
      },
      {
        "type": "exit"
      },
      {
        "type": "text",
        "text": "."
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "type": "enter",
        "tag": "{http://innodatalabs.com/brs}s",
        "attrib": {
          "l": "sourcetitle"
        }
      },
      {
        "type": "text",
        "text": "Industrial"
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "type": "text",
        "text": "Crops"
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "type": "text",
        "text": "and"
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "type": "text",
        "text": "Products"
      },
      {
        "type": "exit"
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "type": "enter",
        "tag": "{http://innodatalabs.com/brs}s",
        "attrib": {
          "l": "vol"
        }
      },
      {
        "type": "text",
        "text": "94"
      },
      {
        "type": "exit"
      },
      {
        "type": "text",
        "text": ":"
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "type": "enter",
        "tag": "{http://innodatalabs.com/brs}s",
        "attrib": {
          "l": "pages"
        }
      },
      {
        "type": "text",
        "text": "197"
      },
      {
        "type": "text",
        "text": "–"
      },
      {
        "type": "text",
        "text": "205"
      },
      {
        "type": "exit"
      },
      {
        "type": "text",
        "text": "."
      },
      {
        "type": "exit"
      }
    ];

    const fused = [...fuseEvents(markup1, markup2)];
    const xmltext = toString(unscan(fused));
    t.is(xmltext, `<ns0:r xmlns:ns0="http://innodatalabs.com/brs" id="data000042:019">\
<ns0:s l="author-person">ABDELLI, M.</ns0:s>, <ns0:s l="author-person">MOGHRANI, H.</ns0:s>, <ns0:s l="author-person">ABOUN, A.</ns0:s> &amp; <ns0:s l="author-person">MAACHI, R.</ns0:s> \
<ns0:s l="publicationyear">2016</ns0:s>. <ns0:s l="titletext">Algerian <ns1:italic xmlns:ns1="http://www.thomsonreuters.com/science/journals">Mentha pulegium</ns1:italic> L. leaves essential oil: chemical composition, antimicrobial, insecticidal and antioxidant activities</ns0:s>. \
<ns1:italic xmlns:ns1="http://www.thomsonreuters.com/science/journals"><ns0:s l="sourcetitle">Industrial Crops and Products</ns0:s></ns1:italic> \
<ns1:bold xmlns:ns1="http://www.thomsonreuters.com/science/journals"><ns0:s l="vol">94</ns0:s>: <ns0:s l="pages">197–</ns0:s></ns1:bold><ns0:s l="pages">205</ns0:s>.</ns0:r>\
`);  // really testing that prev line did not crash with assertion
});