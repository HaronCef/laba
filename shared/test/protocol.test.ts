import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLOSE, parseClientMessage } from '../src/protocol.ts';

function code(raw: string): number | 'ok' {
  const result = parseClientMessage(raw);
  return result.ok ? 'ok' : result.error.code;
}

test('правильні повідомлення проходять', () => {
  assert.equal(code('{"v":0,"type":"join","room":"belt","name":"Kyrylo"}'), 'ok');
  assert.equal(code('{"v":0,"type":"chat","text":"привіт"}'), 'ok');
  assert.equal(code('{"v":0,"type":"leave"}'), 'ok');
  assert.equal(
    code(
      '{"v":0,"type":"input","seq":5,"turn":-1,"thrust":true,"fire":false,"missile":false,"flip":false}',
    ),
    'ok',
  );
});

test('зламані повідомлення отримують свій код і не кидають винятків', () => {
  assert.equal(code('не json'), CLOSE.BAD_MESSAGE);
  assert.equal(code('[1,2]'), CLOSE.BAD_VERSION);
  assert.equal(code('{"v":1,"type":"chat","text":"x"}'), CLOSE.BAD_VERSION);
  assert.equal(code('{"v":0,"type":"fly"}'), CLOSE.UNKNOWN_TYPE);
  assert.equal(code('{"v":0,"type":"constructor"}'), CLOSE.UNKNOWN_TYPE);
  assert.equal(code('{"v":0,"type":"chat","text":""}'), CLOSE.BAD_MESSAGE);
  assert.equal(
    code(`{"v":0,"type":"chat","text":"${'a'.repeat(201)}"}`),
    CLOSE.BAD_MESSAGE,
  );
  assert.equal(code('{"v":0,"type":"join","room":"../x","name":"a"}'), CLOSE.BAD_MESSAGE);
  assert.equal(
    code(
      '{"v":0,"type":"input","seq":5,"turn":1000,"thrust":true,"fire":false,"missile":false,"flip":false}',
    ),
    CLOSE.BAD_MESSAGE,
  );
  assert.equal(parseClientMessage(42).ok, false); // не рядок
});
