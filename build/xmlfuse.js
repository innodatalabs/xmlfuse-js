(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports, require('@innodatalabs/lxmlx-js')) :
    typeof define === 'function' && define.amd ? define(['exports', '@innodatalabs/lxmlx-js'], factory) :
    (global = global || self, factory(global.xmlfuse = {}, global.lxmlxJs));
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

        return lxmlxJs.unscan(events, {nsmap: options.nsmap})
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
                throw new Error('Input documents have different text at offset '
                    + i + ':\n' + snippet1 + '\n' + snippet2);
            }
        }
        const snippet1 = t1.slice(l < 20 ? 0 : l-20, l+20);
        const snippet2 = t2.slice(l < 20 ? 0 : l-20, l+20);
        if (t1.length > t2.length) {
            throw new Error('Master document has longer text than the slave:\n'
            + snippet1 + '\n' + snippet2);
        } else {
            throw new Error('Master document has shorter text than the slave:\n'
            + snippet1 + '\n' + snippet2);
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoieG1sZnVzZS5qcyIsInNvdXJjZXMiOlsiLi4vc3JjL3htbGZ1c2UuanMiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgc2NhbiwgdW5zY2FuLCB0ZXh0T2YsIHdpdGhQZWVyLCBFTlRFUiwgVEVYVCwgRVhJVCwgQ09NTUVOVCwgUEkgfSBmcm9tICdAaW5ub2RhdGFsYWJzL2x4bWx4LWpzJztcblxuY29uc3QgU1BPVCA9ICdzcG90JzsgIC8vIGludGVybmFsIGV2ZW50IHR5cGUgdG8gbWFyayB6ZXJvLWxlbmd0aCBtYXJrdXBcblxuZnVuY3Rpb24gYXNzZXJ0KGNvbmRpdGlvbiwgbWVzc2FnZSkge1xuICAgIGlmICghY29uZGl0aW9uKSB0aHJvdyBuZXcgRXJyb3IoJ0Fzc2VydGlvbiBmYWlsZWQ6ICcgKyBtZXNzYWdlKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZ1c2UoeG1sMSwgeG1sMiwgb3B0aW9ucykge1xuICAgIG9wdGlvbnMgPSBPYmplY3QuYXNzaWduKHtcbiAgICAgICAgYXV0b1NlZ21lbnQ6IHRydWUsXG4gICAgICAgIHByZWZlclNsYXZlSW5uZXI6IHRydWUsXG4gICAgICAgIHN0cmlwU2xhdmVUb3BUYWc6IHRydWUsXG4gICAgICAgIG5zbWFwOiB1bmRlZmluZWQsXG4gICAgfSwgb3B0aW9ucyk7XG5cbiAgICBjb25zdCBldmVudHMxID0gWy4uLnNjYW4oeG1sMSldO1xuICAgIGNvbnN0IGV2ZW50czIgPSBbLi4uc2Nhbih4bWwyKV07XG5cbiAgICBpZiAob3B0aW9ucy5zdHJpcFNsYXZlVG9wVGFnKSB7XG4gICAgICAgIGV2ZW50czIuc3BsaWNlKDAsIDEpO1xuICAgICAgICBldmVudHMyLnNwbGljZShldmVudHMyLmxlbmd0aC0xLCAxKTtcbiAgICB9XG5cbiAgICBjb25zdCBldmVudHMgPSBmdXNlRXZlbnRzKGV2ZW50czEsIGV2ZW50czIsIG9wdGlvbnMpO1xuXG4gICAgcmV0dXJuIHVuc2NhbihldmVudHMsIHtuc21hcDogb3B0aW9ucy5uc21hcH0pXG59XG5cblxuZXhwb3J0IGZ1bmN0aW9uKiBmdXNlRXZlbnRzKGV2ZW50czEsIGV2ZW50czIsIG9wdGlvbnMpIHtcbiAgICBvcHRpb25zID0gT2JqZWN0LmFzc2lnbih7XG4gICAgICAgIGF1dG9TZWdtZW50OiB0cnVlLFxuICAgICAgICBwcmVmZXJTbGF2ZUlubmVyOiB0cnVlLFxuICAgIH0sIG9wdGlvbnMpO1xuXG4gICAgY29uc3QgZXYxID0gWy4uLmV2ZW50czFdO1xuICAgIGNvbnN0IGV2MiA9IFsuLi5ldmVudHMyXTtcblxuICAgIGNvbnN0IHR4MSA9IHRleHRPZihldjEpO1xuICAgIGNvbnN0IHR4MiA9IHRleHRPZihldjIpO1xuICAgIGlmICh0eDEgIT09IHR4Mikge1xuICAgICAgICByYWlzZVRleHREaWZmKHR4MSwgdHgyKVxuICAgIH1cblxuICAgIGNvbnN0IG9mZnNldHMgPSBuZXcgU2V0KFsuLi50ZXh0T2Zmc2V0cyhldjEpLCAuLi50ZXh0T2Zmc2V0cyhldjIpXSk7XG5cbiAgICBjb25zdCBzZXYxID0gc2VnbWVudFRleHQoZXYxLCBvZmZzZXRzKTtcbiAgICBjb25zdCBzZXYyID0gc2VnbWVudFRleHQoZXYyLCBvZmZzZXRzKTtcblxuICAgIHlpZWxkKiBhbmFseXplKHNldjEsIHNldjIsIG9wdGlvbnMpO1xufVxuXG5mdW5jdGlvbiByYWlzZVRleHREaWZmKHQxLCB0Mikge1xuICAgIGNvbnN0IGwgPSB0MS5sZW5ndGggPiB0Mi5sZW5ndGggPyB0Mi5sZW5ndGggOiB0MS5sZW5ndGg7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBsOyBpKyspIHtcbiAgICAgICAgaWYgKHQxW2ldICE9IHQyW2ldKSB7XG4gICAgICAgICAgICBjb25zdCBzbmlwcGV0MSA9IHQxLnNsaWNlKGkgPCAyMCA/IDAgOiBpLTIwLCBpKzIwKTtcbiAgICAgICAgICAgIGNvbnN0IHNuaXBwZXQyID0gdDIuc2xpY2UoaSA8IDIwID8gMCA6IGktMjAsIGkrMjApO1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbnB1dCBkb2N1bWVudHMgaGF2ZSBkaWZmZXJlbnQgdGV4dCBhdCBvZmZzZXQgJ1xuICAgICAgICAgICAgICAgICsgaSArICc6XFxuJyArIHNuaXBwZXQxICsgJ1xcbicgKyBzbmlwcGV0Mik7XG4gICAgICAgIH1cbiAgICB9XG4gICAgY29uc3Qgc25pcHBldDEgPSB0MS5zbGljZShsIDwgMjAgPyAwIDogbC0yMCwgbCsyMCk7XG4gICAgY29uc3Qgc25pcHBldDIgPSB0Mi5zbGljZShsIDwgMjAgPyAwIDogbC0yMCwgbCsyMCk7XG4gICAgaWYgKHQxLmxlbmd0aCA+IHQyLmxlbmd0aCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ01hc3RlciBkb2N1bWVudCBoYXMgbG9uZ2VyIHRleHQgdGhhbiB0aGUgc2xhdmU6XFxuJ1xuICAgICAgICArIHNuaXBwZXQxICsgJ1xcbicgKyBzbmlwcGV0Mik7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdNYXN0ZXIgZG9jdW1lbnQgaGFzIHNob3J0ZXIgdGV4dCB0aGFuIHRoZSBzbGF2ZTpcXG4nXG4gICAgICAgICsgc25pcHBldDEgKyAnXFxuJyArIHNuaXBwZXQyKTtcbiAgICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB0ZXh0T2Zmc2V0cyhldmVudHMpIHtcbiAgICBjb25zdCBvZmZzZXRzID0gbmV3IFNldCgpO1xuXG4gICAgbGV0IG9mZiA9IDA7XG4gICAgZm9yIChjb25zdCBlIG9mIGV2ZW50cykge1xuICAgICAgICBpZiAoZS50eXBlID09PSBURVhUKSB7XG4gICAgICAgICAgICBvZmZzZXRzLmFkZChvZmYpO1xuICAgICAgICAgICAgb2ZmICs9IGUudGV4dC5sZW5ndGg7XG4gICAgICAgIH1cbiAgICB9XG4gICAgb2Zmc2V0cy5hZGQob2ZmKTtcblxuICAgIHJldHVybiBvZmZzZXRzO1xufVxuXG5leHBvcnQgZnVuY3Rpb24qIHNlZ21lbnRUZXh0KGV2ZW50cywgb2Zmc2V0cykge1xuICAgIG9mZnNldHMgPSBbLi4ub2Zmc2V0c10uc29ydCgoYSwgYikgPT4gK2EtYikucmV2ZXJzZSgpO1xuICAgIGlmIChvZmZzZXRzLmxlbmd0aCA+IDAgJiYgb2Zmc2V0c1tvZmZzZXRzLmxlbmd0aC0xXSA9PT0gMCkge1xuICAgICAgICBvZmZzZXRzLnBvcCgpO1xuICAgIH1cblxuICAgIGxldCBvZmYgPSAwO1xuICAgIGZvciAoY29uc3QgZSBvZiBldmVudHMpIHtcbiAgICAgICAgaWYgKGUudHlwZSA9PT0gVEVYVCkge1xuICAgICAgICAgICAgbGV0IHRleHQgPSBlLnRleHQ7XG4gICAgICAgICAgICBsZXQgbCA9IHRleHQubGVuZ3RoO1xuICAgICAgICAgICAgd2hpbGUgKG9mZnNldHMubGVuZ3RoID4gMCAmJiBvZmZzZXRzW29mZnNldHMubGVuZ3RoLTFdIC0gb2ZmIDwgbCkge1xuICAgICAgICAgICAgICAgIGNvbnN0IG8gPSBvZmZzZXRzLnBvcCgpIC0gb2ZmO1xuICAgICAgICAgICAgICAgIHlpZWxkIHt0eXBlOiBURVhULCB0ZXh0OiB0ZXh0LnNsaWNlKDAsIG8pfTtcbiAgICAgICAgICAgICAgICB0ZXh0ID0gdGV4dC5zbGljZShvKTtcbiAgICAgICAgICAgICAgICBvZmYgKz0gbztcbiAgICAgICAgICAgICAgICBsIC09IG87XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB5aWVsZCB7dHlwZTogVEVYVCwgdGV4dDogdGV4dH07XG4gICAgICAgICAgICBvZmYgKz0gdGV4dC5sZW5ndGg7XG4gICAgICAgICAgICBpZiAob2Zmc2V0cy5sZW5ndGggPiAwICYmIG9mZnNldHNbb2Zmc2V0cy5sZW5ndGgtMV0gPT09IG9mZikge1xuICAgICAgICAgICAgICAgIG9mZnNldHMucG9wKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB5aWVsZCBlO1xuICAgICAgICB9XG4gICAgfVxufVxuXG5mdW5jdGlvbiogbm9ybWFsaXplUHJlZml4KHByZWZpeCkge1xuICAgIGNvbnN0IG91dCA9IFtdO1xuICAgIGNvbnN0IHN0YWNrID0gW107XG5cbiAgICBmb3IgKGNvbnN0IGUgb2YgWy4uLnByZWZpeF0ucmV2ZXJzZSgpKSB7XG4gICAgICAgIGlmIChlLnR5cGUgPT09IEVYSVQpIHtcbiAgICAgICAgICAgIHN0YWNrLnB1c2goZSk7XG4gICAgICAgIH0gZWxzZSBpZiAoZS50eXBlID09PSBFTlRFUikge1xuICAgICAgICAgICAgaWYgKHN0YWNrLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICBvdXQuc3BsaWNlKDAsIDAsIGUpO1xuICAgICAgICAgICAgICAgIG91dC5wdXNoKHN0YWNrLnBvcCgpKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgaWYgKG91dC5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICAgICAgeWllbGQge3R5cGU6IFNQT1QsIHNwb3Q6IFsuLi5vdXRdfTtcbiAgICAgICAgICAgICAgICAgICAgb3V0Lmxlbmd0aCA9IDA7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHlpZWxkIGU7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBhc3NlcnQoZS50eXBlID09PSBQSSB8fCBlLnR5cGUgPT09IENPTU1FTlQpO1xuICAgICAgICAgICAgb3V0LnB1c2goZSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAob3V0Lmxlbmd0aCkge1xuICAgICAgICB5aWVsZCB7dHlwZTogU1BPVCwgc3BvdDogb3V0fTtcbiAgICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiogYXNUb2tlblN0cmVhbShldmVudHMpIHtcbiAgICBsZXQgdG9rZW4gPSB7cHJlZml4OiBbXSwgc3VmZml4OiBbXX07XG4gICAgZm9yIChjb25zdCBbZSxwXSBvZiB3aXRoUGVlcihldmVudHMpKSB7XG4gICAgICAgIGlmIChlLnR5cGUgPT09IEVOVEVSIHx8IGUudHlwZSA9PT0gUEkgfHwgZS50eXBlID09PSBDT01NRU5UKSB7XG4gICAgICAgICAgICBpZiAodG9rZW4udGV4dCkge1xuICAgICAgICAgICAgICAgIHlpZWxkIHtcbiAgICAgICAgICAgICAgICAgICAgcHJlZml4OiBbLi4ubm9ybWFsaXplUHJlZml4KHRva2VuLnByZWZpeCldLnJldmVyc2UoKSxcbiAgICAgICAgICAgICAgICAgICAgdGV4dDogdG9rZW4udGV4dCxcbiAgICAgICAgICAgICAgICAgICAgc3VmZml4OiBbLi4udG9rZW4uc3VmZml4XSxcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIHRva2VuID0ge3ByZWZpeDogW10sIHN1ZmZpeDogW119O1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdG9rZW4ucHJlZml4LnB1c2goZSk7XG4gICAgICAgIH0gZWxzZSBpZiAoZS50eXBlID09PSBFWElUKSB7XG4gICAgICAgICAgICBpZiAodG9rZW4udGV4dCkge1xuICAgICAgICAgICAgICAgIHRva2VuLnN1ZmZpeC5wdXNoKHt0eXBlOiBFWElULCBwZWVyOiBwfSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHRva2VuLnByZWZpeC5wdXNoKHt0eXBlOiBFWElULCBwZWVyOiBwfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAoZS50eXBlID09PSBURVhUKSB7XG4gICAgICAgICAgICBpZiAodG9rZW4udGV4dCkge1xuICAgICAgICAgICAgICAgIHlpZWxkIHtcbiAgICAgICAgICAgICAgICAgICAgcHJlZml4OiBbLi4ubm9ybWFsaXplUHJlZml4KHRva2VuLnByZWZpeCldLnJldmVyc2UoKSxcbiAgICAgICAgICAgICAgICAgICAgdGV4dDogdG9rZW4udGV4dCxcbiAgICAgICAgICAgICAgICAgICAgc3VmZml4OiBbLi4udG9rZW4uc3VmZml4XSxcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIHRva2VuID0ge3ByZWZpeDogW10sIHN1ZmZpeDogW119O1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdG9rZW4udGV4dCA9IGUudGV4dDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcigndW5leHBlY3RlZCBldmVudCB0eXBlOiAnICsgZSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAodG9rZW4udGV4dCkge1xuICAgICAgICB5aWVsZCB7XG4gICAgICAgICAgICBwcmVmaXg6IFsuLi5ub3JtYWxpemVQcmVmaXgodG9rZW4ucHJlZml4KV0ucmV2ZXJzZSgpLFxuICAgICAgICAgICAgdGV4dDogdG9rZW4udGV4dCxcbiAgICAgICAgICAgIHN1ZmZpeDogWy4uLnRva2VuLnN1ZmZpeF0sXG4gICAgICAgIH07XG4gICAgfVxufVxuXG5mdW5jdGlvbiB6aXAoYXJyMSwgYXJyMikge1xuICAgIGlmIChhcnIxLmxlbmd0aCA8IGFycjIubGVuZ3RoKSB7XG4gICAgICAgIHJldHVybiBhcnIxLm1hcCgoaywgaSkgPT4gW2ssIGFycjJbaV1dKTtcbiAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gYXJyMi5tYXAoKGssIGkpID0+IFthcnIxW2ldLCBrXSk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiogYW5hbHl6ZShldmVudHMxLCBldmVudHMyLCBvcHRpb25zKSB7XG4gICAgb3B0aW9ucyA9IE9iamVjdC5hc3NpZ24oe1xuICAgICAgICBwcmVmZXJTbGF2ZUlubmVyOiB0cnVlLFxuICAgICAgICBhdXRvU2VnbWVudDogdHJ1ZSxcbiAgICB9LCBvcHRpb25zKTtcblxuICAgIGNvbnN0IHN5bmMgPSBbXTtcblxuICAgIGZvciAoY29uc3QgW21hc3Rlciwgc2xhdmVdIG9mIHppcChbLi4uYXNUb2tlblN0cmVhbShldmVudHMxKV0sIFsuLi5hc1Rva2VuU3RyZWFtKGV2ZW50czIpXSkpIHtcbiAgICAgICAgYXNzZXJ0KG1hc3Rlci50ZXh0ID09PSBzbGF2ZS50ZXh0KTtcbiAgICAgICAgc3luYy5wdXNoKHtcbiAgICAgICAgICAgIG1hc3RlcjogbWFzdGVyLFxuICAgICAgICAgICAgc2xhdmU6IHNsYXZlLFxuICAgICAgICAgICAgdGV4dDogbWFzdGVyLnRleHQsXG4gICAgICAgICAgICBwcmVmaXg6IFtdLFxuICAgICAgICAgICAgc3VmZml4OiBbXSxcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gbG9jYWxSZWR1Y2UocHJlZml4LCBzdWZmaXgsIG91dFByZWZpeCwgb3V0U3VmZml4KSB7XG4gICAgICAgIHdoaWxlIChwcmVmaXgubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgaWYgKHByZWZpeFtwcmVmaXgubGVuZ3RoLTFdLnR5cGUgPT09IFNQT1QpIHtcbiAgICAgICAgICAgICAgICBvdXRQcmVmaXguc3BsaWNlKDAsIDAsIHByZWZpeC5wb3AoKSk7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoc3VmZml4Lmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29uc3QgeCA9IHByZWZpeC5wb3AoKTtcbiAgICAgICAgICAgIGFzc2VydCh4LnR5cGUgPT09IEVOVEVSLCAnbG9jYWxSZWR1Y2UxJyk7XG4gICAgICAgICAgICBvdXRQcmVmaXguc3BsaWNlKDAsIDAsIHgpO1xuICAgICAgICAgICAgY29uc3QgW3ldID0gc3VmZml4LnNwbGljZSgwLCAxKTtcbiAgICAgICAgICAgIGFzc2VydCh5LnR5cGUgPT09IEVYSVQsICdsb2NhbFJlZHVjZTInKTtcbiAgICAgICAgICAgIGFzc2VydCh5LnBlZXIgPT09IHgsICdsb2NhbFJlZHVjZTMnKTtcbiAgICAgICAgICAgIG91dFN1ZmZpeC5wdXNoKHkpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gaGVscGVyKGluZGV4KSB7XG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgaW5kZXg7IGkrKykge1xuICAgICAgICAgICAgY29uc3QgcyA9IHN5bmNbaV07XG4gICAgICAgICAgICBhc3NlcnQocy5tYXN0ZXIuc3VmZml4Lmxlbmd0aCA9PT0gMCwgJ3ByZWNvbmRpdGlvbiBmYWlsZWQgKDEpJyk7XG4gICAgICAgICAgICBhc3NlcnQocy5zbGF2ZS5zdWZmaXgubGVuZ3RoID09PSAwLCAncHJlY29uZGl0aW9uIGZhaWxlZCAoMiknKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGggPSBzeW5jW2luZGV4XTtcbiAgICAgICAgZm9yIChsZXQgaSA9IGluZGV4OyBpID49IDA7IGktLSkge1xuICAgICAgICAgICAgY29uc3QgbCA9IHN5bmNbaV07XG5cbiAgICAgICAgICAgIGlmIChvcHRpb25zLnByZWZlclNsYXZlSW5uZXIpIHtcbiAgICAgICAgICAgICAgICBsb2NhbFJlZHVjZShsLnNsYXZlLnByZWZpeCwgaC5zbGF2ZS5zdWZmaXgsIGwucHJlZml4LCBoLnN1ZmZpeCk7XG4gICAgICAgICAgICAgICAgbG9jYWxSZWR1Y2UobC5tYXN0ZXIucHJlZml4LCBoLm1hc3Rlci5zdWZmaXgsIGwucHJlZml4LCBoLnN1ZmZpeCk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGxvY2FsUmVkdWNlKGwubWFzdGVyLnByZWZpeCwgaC5tYXN0ZXIuc3VmZml4LCBsLnByZWZpeCwgaC5zdWZmaXgpO1xuICAgICAgICAgICAgICAgIGxvY2FsUmVkdWNlKGwuc2xhdmUucHJlZml4LCBoLnNsYXZlLnN1ZmZpeCwgbC5wcmVmaXgsIGguc3VmZml4KTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGgubWFzdGVyLnN1ZmZpeC5sZW5ndGggPT09IDAgJiYgaC5zbGF2ZS5zdWZmaXgubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuOyAgLy8gcmVhY2hlZCBvdXIgaW52YXJpYW50LCBkb25lIGhlbHBlclxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAobC5tYXN0ZXIucHJlZml4Lmxlbmd0aCA9PT0gMCAmJiBsLnNsYXZlLnByZWZpeC5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICAgICBjb250aW51ZTsgIC8vIG1hdGNoIHdpdGggZWFybGllciB0YWdzXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIGhlcmUgd2UgaGF2ZSBhIGNvbmZsaWN0XG4gICAgICAgICAgICBpZiAoIW9wdGlvbnMuYXV0b1NlZ21lbnQpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBvID0gbC5tYXN0ZXIucHJlZml4Lmxlbmd0aCA/XG4gICAgICAgICAgICAgICAgICAgIGwubWFzdGVyLnByZWZpeFtsLm1hc3Rlci5wcmVmaXgubGVuZ3RoLTFdIDpcbiAgICAgICAgICAgICAgICAgICAgbC5zbGF2ZS5wcmVmaXhbbC5zbGF2ZS5wcmVmaXgubGVuZ3RoLTFdO1xuICAgICAgICAgICAgICAgIGNvbnN0IGMgPSBoLm1hc3Rlci5zdWZmaXgubGVuZ3RoID9cbiAgICAgICAgICAgICAgICAgICAgaC5tYXN0ZXIuc3VmZml4WzBdIDogaC5zbGF2ZS5zdWZmaXhbMF07XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdDb25mbGljdGluZyBtYXJrdXA6IDwnICsgby50YWcgK1xuICAgICAgICAgICAgICAgICAgICAnPiBqdXN0IGJlZm9yZSBcIicgKyBsLnRleHQgKyAnXCIgYW5kIDwvJyArIGMucGVlci50YWcgK1xuICAgICAgICAgICAgICAgICAgICAnPiBqdXN0IGFmdGVyIFwiJyArIGgudGV4dCArICdcIicpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAobC5tYXN0ZXIucHJlZml4Lmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICBhc3NlcnQobC5zbGF2ZS5wcmVmaXgubGVuZ3RoID09PSAwLCAnaGVscGVyLWEwJyk7XG4gICAgICAgICAgICAgICAgYXNzZXJ0KGgubWFzdGVyLnN1ZmZpeC5sZW5ndGggPT09IDAsICdoZWxwZXItYTEnKTtcbiAgICAgICAgICAgICAgICBhc3NlcnQoaC5zbGF2ZS5zdWZmaXgubGVuZ3RoID4gMCwgJ2hlbHBlci1hMicpO1xuICAgICAgICAgICAgICAgIC8vIGNsb3NlIHNsYXZlIG9uIHRoZSBwcmV2IHN0ZXAgYW5kIHJlLW9wZW4gaGVyZVxuXG4gICAgICAgICAgICAgICAgc3luY1tpLTFdLnNsYXZlLnN1ZmZpeC5wdXNoKC4uLmguc2xhdmUuc3VmZml4KTtcbiAgICAgICAgICAgICAgICBmb3IoY29uc3QgZSBvZiBbLi4uaC5zbGF2ZS5zdWZmaXhdLnJldmVyc2UoKSkge1xuICAgICAgICAgICAgICAgICAgICBsLnByZWZpeC5wdXNoKGUucGVlcik7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGguc3VmZml4LnB1c2goLi4uaC5zbGF2ZS5zdWZmaXgpO1xuICAgICAgICAgICAgICAgIGguc2xhdmUuc3VmZml4Lmxlbmd0aCA9IDA7XG4gICAgICAgICAgICAgICAgZm9yIChsZXQgaiA9IGkgLSAxOyBqID49IDA7IGotLSkge1xuICAgICAgICAgICAgICAgICAgICBsb2NhbFJlZHVjZShzeW5jW2pdLnNsYXZlLnByZWZpeCwgc3luY1tpLTFdLnNsYXZlLnN1ZmZpeCwgc3luY1tqXS5wcmVmaXgsIHN5bmNbaS0xXS5zdWZmaXgpO1xuICAgICAgICAgICAgICAgICAgICBpZiAoc3luY1tpLTFdLnNsYXZlLnN1ZmZpeC5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrOyAgLy8gZm9yIHNwZWVkXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgYXNzZXJ0KCBzeW5jW2ktMV0uc2xhdmUuc3VmZml4Lmxlbmd0aCA9PT0gMCwgJygxKSBzYW5pdHknKTtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgYXNzZXJ0KGwuc2xhdmUucHJlZml4Lmxlbmd0aCA+IDAsICdoZWxwZXItYjAnKTtcbiAgICAgICAgICAgICAgICBhc3NlcnQoaC5zbGF2ZS5zdWZmaXgubGVuZ3RoID09PSAwLCAnaGVscGVyLWIxJyk7XG4gICAgICAgICAgICAgICAgYXNzZXJ0KGgubWFzdGVyLnN1ZmZpeC5sZW5ndGggPiAwLCAnaGVscGVyLWIyJyk7XG4gICAgICAgICAgICAgICAgLy8gY2xvc2Ugc2xhdmUgaGVyZSBhbmQgcmUtb3BlbiBvbiB0aGUgcmlnaHRcbiAgICAgICAgICAgICAgICBsLnByZWZpeC5wdXNoKC4uLmwuc2xhdmUucHJlZml4KTtcbiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IGUgb2YgWy4uLmwuc2xhdmUucHJlZml4XS5yZXZlcnNlKCkpIHtcbiAgICAgICAgICAgICAgICAgICAgaC5zdWZmaXgucHVzaCh7dHlwZTogRVhJVCwgcGVlcjogZX0pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBzeW5jW2luZGV4KzFdLnNsYXZlLnByZWZpeC5wdXNoKC4uLmwuc2xhdmUucHJlZml4KTtcbiAgICAgICAgICAgICAgICBsLnNsYXZlLnByZWZpeC5sZW5ndGggPSAwO1xuICAgICAgICAgICAgICAgIGZvciAobGV0IGogPSBpIC0gMTsgaiA+PSAwOyBqLS0pIHtcbiAgICAgICAgICAgICAgICAgICAgbG9jYWxSZWR1Y2Uoc3luY1tqXS5tYXN0ZXIucHJlZml4LCBzeW5jW2ldLm1hc3Rlci5zdWZmaXgsIHN5bmNbal0ucHJlZml4LCBzeW5jW2ldLnN1ZmZpeCk7XG4gICAgICAgICAgICAgICAgICAgIGlmIChzeW5jW2ldLm1hc3Rlci5zdWZmaXgubGVndGggPT09IDApIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGFzc2VydChzeW5jW2ldLm1hc3Rlci5zdWZmaXgubGVuZ3RoID09PSAwLCAnKDIpIHNhbml0eScpXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IHN5bmMubGVuZ3RoOyBpbmRleCArPSAxKSB7XG4gICAgICAgIGhlbHBlcihpbmRleCk7XG4gICAgfVxuXG4gICAgY29uc3Qgc3RhY2sgPSBbXTtcbiAgICBmb3IgKGxldCB4ID0gMDsgeCA8IHN5bmMubGVuZ3RoOyB4KyspIHtcbiAgICAgICAgY29uc3QgdCA9IHN5bmNbeF07XG5cbiAgICAgICAgZm9yIChsZXQgeSA9IDA7IHkgPCB0LnByZWZpeC5sZW5ndGg7IHkrKykge1xuICAgICAgICAgICAgY29uc3QgZSA9IHQucHJlZml4W3ldO1xuICAgICAgICAgICAgaWYgKGUudHlwZSA9PT0gU1BPVCkge1xuICAgICAgICAgICAgICAgIHlpZWxkKiBlLnNwb3Q7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGFzc2VydChlLnR5cGUgPT09IEVOVEVSKTtcbiAgICAgICAgICAgICAgICBzdGFjay5wdXNoKGUpO1xuICAgICAgICAgICAgICAgIHlpZWxkIGU7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICB5aWVsZCB7dHlwZTogVEVYVCwgdGV4dDogdC50ZXh0fTtcblxuICAgICAgICBmb3IgKGxldCB5ID0gMDsgeSA8IHQuc3VmZml4Lmxlbmd0aDsgeSsrKSB7XG4gICAgICAgICAgICBjb25zdCBlID0gdC5zdWZmaXhbeV07XG4gICAgICAgICAgICBhc3NlcnQoZS50eXBlID09PSBFWElUKTtcbiAgICAgICAgICAgIGFzc2VydChlLnBlZXIgPT09IHN0YWNrW3N0YWNrLmxlbmd0aC0xXSk7XG4gICAgICAgICAgICBzdGFjay5wb3AoKTtcblxuICAgICAgICAgICAgeWllbGQge3R5cGU6IEVYSVR9O1xuICAgICAgICB9XG4gICAgfVxufVxuIl0sIm5hbWVzIjpbInNjYW4iLCJ1bnNjYW4iLCJ0ZXh0T2YiLCJURVhUIiwiRVhJVCIsIkVOVEVSIiwiUEkiLCJDT01NRU5UIiwid2l0aFBlZXIiXSwibWFwcGluZ3MiOiI7Ozs7OztJQUVBLE1BQU0sSUFBSSxHQUFHLE1BQU0sQ0FBQzs7SUFFcEIsU0FBUyxNQUFNLENBQUMsU0FBUyxFQUFFLE9BQU8sRUFBRTtJQUNwQyxJQUFJLElBQUksQ0FBQyxTQUFTLEVBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxvQkFBb0IsR0FBRyxPQUFPLENBQUMsQ0FBQztJQUNwRSxDQUFDOztBQUVELElBQU8sU0FBUyxJQUFJLENBQUMsSUFBSSxFQUFFLElBQUksRUFBRSxPQUFPLEVBQUU7SUFDMUMsSUFBSSxPQUFPLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQztJQUM1QixRQUFRLFdBQVcsRUFBRSxJQUFJO0lBQ3pCLFFBQVEsZ0JBQWdCLEVBQUUsSUFBSTtJQUM5QixRQUFRLGdCQUFnQixFQUFFLElBQUk7SUFDOUIsUUFBUSxLQUFLLEVBQUUsU0FBUztJQUN4QixLQUFLLEVBQUUsT0FBTyxDQUFDLENBQUM7O0lBRWhCLElBQUksTUFBTSxPQUFPLEdBQUcsQ0FBQyxHQUFHQSxZQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQztJQUNwQyxJQUFJLE1BQU0sT0FBTyxHQUFHLENBQUMsR0FBR0EsWUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7O0lBRXBDLElBQUksSUFBSSxPQUFPLENBQUMsZ0JBQWdCLEVBQUU7SUFDbEMsUUFBUSxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQztJQUM3QixRQUFRLE9BQU8sQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUM7SUFDNUMsS0FBSzs7SUFFTCxJQUFJLE1BQU0sTUFBTSxHQUFHLFVBQVUsQ0FBQyxPQUFPLEVBQUUsT0FBTyxFQUFFLE9BQU8sQ0FBQyxDQUFDOztJQUV6RCxJQUFJLE9BQU9DLGNBQU0sQ0FBQyxNQUFNLEVBQUUsQ0FBQyxLQUFLLEVBQUUsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBQ2pELENBQUM7OztBQUdELElBQU8sVUFBVSxVQUFVLENBQUMsT0FBTyxFQUFFLE9BQU8sRUFBRSxPQUFPLEVBQUU7SUFDdkQsSUFBSSxPQUFPLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQztJQUM1QixRQUFRLFdBQVcsRUFBRSxJQUFJO0lBQ3pCLFFBQVEsZ0JBQWdCLEVBQUUsSUFBSTtJQUM5QixLQUFLLEVBQUUsT0FBTyxDQUFDLENBQUM7O0lBRWhCLElBQUksTUFBTSxHQUFHLEdBQUcsQ0FBQyxHQUFHLE9BQU8sQ0FBQyxDQUFDO0lBQzdCLElBQUksTUFBTSxHQUFHLEdBQUcsQ0FBQyxHQUFHLE9BQU8sQ0FBQyxDQUFDOztJQUU3QixJQUFJLE1BQU0sR0FBRyxHQUFHQyxjQUFNLENBQUMsR0FBRyxDQUFDLENBQUM7SUFDNUIsSUFBSSxNQUFNLEdBQUcsR0FBR0EsY0FBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBQzVCLElBQUksSUFBSSxHQUFHLEtBQUssR0FBRyxFQUFFO0lBQ3JCLFFBQVEsYUFBYSxDQUFDLEdBQUcsRUFBRSxHQUFHLEVBQUM7SUFDL0IsS0FBSzs7SUFFTCxJQUFJLE1BQU0sT0FBTyxHQUFHLElBQUksR0FBRyxDQUFDLENBQUMsR0FBRyxXQUFXLENBQUMsR0FBRyxDQUFDLEVBQUUsR0FBRyxXQUFXLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDOztJQUV4RSxJQUFJLE1BQU0sSUFBSSxHQUFHLFdBQVcsQ0FBQyxHQUFHLEVBQUUsT0FBTyxDQUFDLENBQUM7SUFDM0MsSUFBSSxNQUFNLElBQUksR0FBRyxXQUFXLENBQUMsR0FBRyxFQUFFLE9BQU8sQ0FBQyxDQUFDOztJQUUzQyxJQUFJLE9BQU8sT0FBTyxDQUFDLElBQUksRUFBRSxJQUFJLEVBQUUsT0FBTyxDQUFDLENBQUM7SUFDeEMsQ0FBQzs7SUFFRCxTQUFTLGFBQWEsQ0FBQyxFQUFFLEVBQUUsRUFBRSxFQUFFO0lBQy9CLElBQUksTUFBTSxDQUFDLEdBQUcsRUFBRSxDQUFDLE1BQU0sR0FBRyxFQUFFLENBQUMsTUFBTSxHQUFHLEVBQUUsQ0FBQyxNQUFNLEdBQUcsRUFBRSxDQUFDLE1BQU0sQ0FBQztJQUM1RCxJQUFJLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxFQUFFLEVBQUU7SUFDaEMsUUFBUSxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFDLEVBQUU7SUFDNUIsWUFBWSxNQUFNLFFBQVEsR0FBRyxFQUFFLENBQUMsS0FBSyxDQUFDLENBQUMsR0FBRyxFQUFFLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDO0lBQy9ELFlBQVksTUFBTSxRQUFRLEdBQUcsRUFBRSxDQUFDLEtBQUssQ0FBQyxDQUFDLEdBQUcsRUFBRSxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQztJQUMvRCxZQUFZLE1BQU0sSUFBSSxLQUFLLENBQUMsZ0RBQWdEO0lBQzVFLGtCQUFrQixDQUFDLEdBQUcsS0FBSyxHQUFHLFFBQVEsR0FBRyxJQUFJLEdBQUcsUUFBUSxDQUFDLENBQUM7SUFDMUQsU0FBUztJQUNULEtBQUs7SUFDTCxJQUFJLE1BQU0sUUFBUSxHQUFHLEVBQUUsQ0FBQyxLQUFLLENBQUMsQ0FBQyxHQUFHLEVBQUUsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUM7SUFDdkQsSUFBSSxNQUFNLFFBQVEsR0FBRyxFQUFFLENBQUMsS0FBSyxDQUFDLENBQUMsR0FBRyxFQUFFLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDO0lBQ3ZELElBQUksSUFBSSxFQUFFLENBQUMsTUFBTSxHQUFHLEVBQUUs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
