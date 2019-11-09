(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports, require('@innodatalabs/lxmlx-js')) :
    typeof define === 'function' && define.amd ? define(['exports', '@innodatalabs/lxmlx-js'], factory) :
    (global = global || self, factory(global.xmlfuse = {}, global.lxmlx));
}(this, (function (exports, lxmlxJs) { 'use strict';

    const SPOT = 'spot';  // internal event type to mark zero-length markup

    function assert(condition, message) {
        if (!condition) throw new Error('Assertion failed: ' + message);
    }

    function fuse(xml1, xml2, options) {
        options = Object.assign({
            autoSegment: true,
            preferSlaveInner: true,
            stripSlaveTopTag: true,
            nsmap: undefined,
        }, options);

        const events1 = [...lxmlxJs.scan(xml1)];
        const events2 = [...lxmlxJs.scan(xml2)];

        if (options.stripSlaveTopTag) {
            events2.splice(0, 1);
            events2.splice(events2.length-1, 1);
        }

        const events = fuseEvents(events1, events2, options);

        return lxmlxJs.unscan(events, {nsmap: options.nsmap});
    }


    function* fuseEvents(events1, events2, options) {
        options = Object.assign({
            autoSegment: true,
            preferSlaveInner: true,
        }, options);

        const ev1 = [...events1];
        const ev2 = [...events2];

        const tx1 = lxmlxJs.textOf(ev1);
        const tx2 = lxmlxJs.textOf(ev2);
        if (tx1 !== tx2) {
            raiseTextDiff(tx1, tx2);
        }

        const offsets = new Set([...textOffsets(ev1), ...textOffsets(ev2)]);

        const sev1 = segmentText(ev1, offsets);
        const sev2 = segmentText(ev2, offsets);

        yield* analyze(sev1, sev2, options);
    }

    function raiseTextDiff(t1, t2) {
        const l = t1.length > t2.length ? t2.length : t1.length;
        for (let i = 0; i < l; i++) {
            if (t1[i] != t2[i]) {
                const snippet1 = t1.slice(i < 20 ? 0 : i-20, i+20);
                const snippet2 = t2.slice(i < 20 ? 0 : i-20, i+20);
                throw new Error('Input documents have different text at offset ' +
                    i + ':\n' + snippet1 + '\n' + snippet2);
            }
        }
        const snippet1 = t1.slice(l < 20 ? 0 : l-20, l+20);
        const snippet2 = t2.slice(l < 20 ? 0 : l-20, l+20);
        if (t1.length > t2.length) {
            throw new Error('Master document has longer text than the slave:\n' +
                snippet1 + '\n' + snippet2);
        } else {
            throw new Error('Master document has shorter text than the slave:\n' +
                snippet1 + '\n' + snippet2);
        }
    }

    function textOffsets(events) {
        const offsets = new Set();

        let off = 0;
        for (const e of events) {
            if (e.type === lxmlxJs.TEXT) {
                offsets.add(off);
                off += e.text.length;
            }
        }
        offsets.add(off);

        return offsets;
    }

    function* segmentText(events, offsets) {
        offsets = [...offsets].sort((a, b) => +a-b).reverse();
        if (offsets.length > 0 && offsets[offsets.length-1] === 0) {
            offsets.pop();
        }

        let off = 0;
        for (const e of events) {
            if (e.type === lxmlxJs.TEXT) {
                let text = e.text;
                let l = text.length;
                while (offsets.length > 0 && offsets[offsets.length-1] - off < l) {
                    const o = offsets.pop() - off;
                    yield {type: lxmlxJs.TEXT, text: text.slice(0, o)};
                    text = text.slice(o);
                    off += o;
                    l -= o;
                }
                yield {type: lxmlxJs.TEXT, text: text};
                off += text.length;
                if (offsets.length > 0 && offsets[offsets.length-1] === off) {
                    offsets.pop();
                }
            } else {
                yield e;
            }
        }
    }

    function* normalizePrefix(prefix) {
        const out = [];
        const stack = [];

        for (const e of [...prefix].reverse()) {
            if (e.type === lxmlxJs.EXIT) {
                stack.push(e);
            } else if (e.type === lxmlxJs.ENTER) {
                if (stack.length > 0) {
                    out.splice(0, 0, e);
                    out.push(stack.pop());
                } else {
                    if (out.length) {
                        yield {type: SPOT, spot: [...out]};
                        out.length = 0;
                    }
                    yield e;
                }
            } else {
                assert(e.type === lxmlxJs.PI || e.type === lxmlxJs.COMMENT);
                out.push(e);
            }
        }

        if (out.length) {
            yield {type: SPOT, spot: out};
        }
    }

    function* asTokenStream(events) {
        let token = {prefix: [], suffix: []};
        for (const [e,p] of lxmlxJs.withPeer(events)) {
            if (e.type === lxmlxJs.ENTER || e.type === lxmlxJs.PI || e.type === lxmlxJs.COMMENT) {
                if (token.text) {
                    yield {
                        prefix: [...normalizePrefix(token.prefix)].reverse(),
                        text: token.text,
                        suffix: [...token.suffix],
                    };
                    token = {prefix: [], suffix: []};
                }
                token.prefix.push(e);
            } else if (e.type === lxmlxJs.EXIT) {
                if (token.text) {
                    token.suffix.push({type: lxmlxJs.EXIT, peer: p});
                } else {
                    token.prefix.push({type: lxmlxJs.EXIT, peer: p});
                }
            } else if (e.type === lxmlxJs.TEXT) {
                if (token.text) {
                    yield {
                        prefix: [...normalizePrefix(token.prefix)].reverse(),
                        text: token.text,
                        suffix: [...token.suffix],
                    };
                    token = {prefix: [], suffix: []};
                }
                token.text = e.text;
            } else {
                throw new Error('unexpected event type: ' + e);
            }
        }

        if (token.text) {
            yield {
                prefix: [...normalizePrefix(token.prefix)].reverse(),
                text: token.text,
                suffix: [...token.suffix],
            };
        }
    }

    function zip(arr1, arr2) {
        if (arr1.length < arr2.length) {
            return arr1.map((k, i) => [k, arr2[i]]);
        } else {
            return arr2.map((k, i) => [arr1[i], k]);
        }
    }

    function* analyze(events1, events2, options) {
        options = Object.assign({
            preferSlaveInner: true,
            autoSegment: true,
        }, options);

        const sync = [];

        for (const [master, slave] of zip([...asTokenStream(events1)], [...asTokenStream(events2)])) {
            assert(master.text === slave.text);
            sync.push({
                master: master,
                slave: slave,
                text: master.text,
                prefix: [],
                suffix: [],
            });
        }

        function localReduce(prefix, suffix, outPrefix, outSuffix) {
            while (prefix.length > 0) {
                if (prefix[prefix.length-1].type === SPOT) {
                    outPrefix.splice(0, 0, prefix.pop());
                    continue;
                }
                if (suffix.length === 0) {
                    break;
                }
                const x = prefix.pop();
                assert(x.type === lxmlxJs.ENTER, 'localReduce1');
                outPrefix.splice(0, 0, x);
                const [y] = suffix.splice(0, 1);
                assert(y.type === lxmlxJs.EXIT, 'localReduce2');
                assert(y.peer === x, 'localReduce3');
                outSuffix.push(y);
            }
        }

        function helper(index) {
            for (let i = 0; i < index; i++) {
                const s = sync[i];
                assert(s.master.suffix.length === 0, 'precondition failed (1)');
                assert(s.slave.suffix.length === 0, 'precondition failed (2)');
            }

            const h = sync[index];
            for (let i = index; i >= 0; i--) {
                const l = sync[i];

                if (options.preferSlaveInner) {
                    localReduce(l.slave.prefix, h.slave.suffix, l.prefix, h.suffix);
                    localReduce(l.master.prefix, h.master.suffix, l.prefix, h.suffix);
                } else {
                    localReduce(l.master.prefix, h.master.suffix, l.prefix, h.suffix);
                    localReduce(l.slave.prefix, h.slave.suffix, l.prefix, h.suffix);
                }

                if (h.master.suffix.length === 0 && h.slave.suffix.length === 0) {
                    return;  // reached our invariant, done helper
                }

                if (l.master.prefix.length === 0 && l.slave.prefix.length === 0) {
                    continue;  // match with earlier tags
                }

                // here we have a conflict
                if (!options.autoSegment) {
                    const o = l.master.prefix.length ?
                        l.master.prefix[l.master.prefix.length-1] :
                        l.slave.prefix[l.slave.prefix.length-1];
                    const c = h.master.suffix.length ?
                        h.master.suffix[0] : h.slave.suffix[0];
                    throw new Error('Conflicting markup: <' + o.tag +
                        '> just before "' + l.text + '" and </' + c.peer.tag +
                        '> just after "' + h.text + '"');
                }

                if (l.master.prefix.length > 0) {
                    assert(l.slave.prefix.length === 0, 'helper-a0');
                    assert(h.master.suffix.length === 0, 'helper-a1');
                    assert(h.slave.suffix.length > 0, 'helper-a2');
                    // close slave on the prev step and re-open here

                    sync[i-1].slave.suffix.push(...h.slave.suffix);
                    for(const e of [...h.slave.suffix].reverse()) {
                        l.prefix.push(e.peer);
                    }
                    h.suffix.push(...h.slave.suffix);
                    h.slave.suffix.length = 0;
                    for (let j = i - 1; j >= 0; j--) {
                        localReduce(sync[j].slave.prefix, sync[i-1].slave.suffix, sync[j].prefix, sync[i-1].suffix);
                        if (sync[i-1].slave.suffix.length === 0) {
                            break;  // for speed
                        }
                    }
                    assert( sync[i-1].slave.suffix.length === 0, '(1) sanity');
                    continue;
                } else {
                    assert(l.slave.prefix.length > 0, 'helper-b0');
                    assert(h.slave.suffix.length === 0, 'helper-b1');
                    assert(h.master.suffix.length > 0, 'helper-b2');
                    // close slave here and re-open on the right
                    l.prefix.push(...l.slave.prefix);
                    for (const e of [...l.slave.prefix].reverse()) {
                        h.suffix.push({type: lxmlxJs.EXIT, peer: e});
                    }
                    sync[index+1].slave.prefix.push(...l.slave.prefix);
                    l.slave.prefix.length = 0;
                    for (let j = i - 1; j >= 0; j--) {
                        localReduce(sync[j].master.prefix, sync[i].master.suffix, sync[j].prefix, sync[i].suffix);
                        if (sync[i].master.suffix.legth === 0) {
                            break;
                        }
                    }
                    assert(sync[i].master.suffix.length === 0, '(2) sanity');
                    return;
                }
            }
        }

        for (let index = 0; index < sync.length; index += 1) {
            helper(index);
        }

        const stack = [];
        for (let x = 0; x < sync.length; x++) {
            const t = sync[x];

            for (let y = 0; y < t.prefix.length; y++) {
                const e = t.prefix[y];
                if (e.type === SPOT) {
                    yield* e.spot;
                } else {
                    assert(e.type === lxmlxJs.ENTER);
                    stack.push(e);
                    yield e;
                }
            }

            yield {type: lxmlxJs.TEXT, text: t.text};

            for (let y = 0; y < t.suffix.length; y++) {
                const e = t.suffix[y];
                assert(e.type === lxmlxJs.EXIT);
                assert(e.peer === stack[stack.length-1]);
                stack.pop();

                yield {type: lxmlxJs.EXIT};
            }
        }
    }

    exports.asTokenStream = asTokenStream;
    exports.fuse = fuse;
    exports.fuseEvents = fuseEvents;
    exports.segmentText = segmentText;
    exports.textOffsets = textOffsets;

    Object.defineProperty(exports, '__esModule', { value: true });

})));
//# sourceMappingURL=index.js.map
