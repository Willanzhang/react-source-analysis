/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  needsStateRestore,
  restoreStateIfNeeded,
} from './ReactControlledComponent';

// Used as a way to call batchedUpdates when we don't have a reference to
// the renderer. Such as when we're dispatching events or if third party
// libraries need to call batchedUpdates. Eventually, this API will go away when
// everything is batched by default. We'll then have a similar API to opt-out of
// scheduled work and instead do synchronous work.

// Defaults
let _batchedUpdatesImpl = function(fn, bookkeeping) {
  return fn(bookkeeping);
};
let _interactiveUpdatesImpl = function(fn, a, b) {
  // 最终这里执行的还是dispatchEvent
  return fn(a, b);
};
let _flushInteractiveUpdatesImpl = function() {};

let isBatching = false;
export function batchedUpdates(fn, bookkeeping) {
  if (isBatching) {
    // If we are currently inside another batch, we need to wait until it
    // fully completes before restoring state.
    return fn(bookkeeping);
  }
  isBatching = true;
  try {
    // _batchedUpdatesImpl 就是调用 fn(bookkeeping) 看此文件最下方 知道注入后 是ReactFiberScheduler.js 中的 batchedUpdate
    return _batchedUpdatesImpl(fn, bookkeeping);
  } finally {
    // Here we wait until all updates have propagated, which is important
    // when using controlled components within layers:
    // https://github.com/facebook/react/issues/1698
    // Then we restore state of any controlled component.
    isBatching = false;

    // 下面这段代码 和controlled inputs有关， 就是 一个input的value 绑定一个值， 
    // 但是如果不用 onChange绑定方法处理state  直接输入是不会改变value 这里就是处理相关问题
    const controlledComponentsHavePendingUpdates = needsStateRestore();
    if (controlledComponentsHavePendingUpdates) {
      // If a controlled event was fired, we may need to restore the state of
      // the DOM node back to the controlled value. This is necessary when React
      // bails out of the update without touching the DOM.
      // 这个也是来自 ReactFiberScheduler.js   flushInteractiveUpdates 方法 直接去执行了 performWork
      // 因为这里创建的 update 有可能 是处于 ConCurrentMode 下
      // 也是一个 interactiveUpdate   也是具有expirationTime  会通过 切片更新（scheduler）
      // 但对于一个 controlled inputs 来说 如果操作的内容被调度更新了， 会有卡顿的感觉
      // 所以在这里需要回调数据 需要强制输出内容  flushInteractiveUpdates 中直接调用 performWork同步的情况
      _flushInteractiveUpdatesImpl();
      restoreStateIfNeeded();
    }
  }
}

export function interactiveUpdates(fn, a, b) {
  return _interactiveUpdatesImpl(fn, a, b);
}

export function flushInteractiveUpdates() {
  return _flushInteractiveUpdatesImpl();
}

// 这三个参数都是来自 ReactFiberScheduler.js的 batchedUpdates interactiveUpdates flushInteractiveUpdates
export function setBatchingImplementation(
  batchedUpdatesImpl,
  interactiveUpdatesImpl,
  flushInteractiveUpdatesImpl,
) {
  _batchedUpdatesImpl = batchedUpdatesImpl;
  _interactiveUpdatesImpl = interactiveUpdatesImpl;
  _flushInteractiveUpdatesImpl = flushInteractiveUpdatesImpl;
}
