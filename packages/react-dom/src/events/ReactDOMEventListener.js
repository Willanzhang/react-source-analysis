/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {AnyNativeEvent} from 'events/PluginModuleType';
import type {Fiber} from 'react-reconciler/src/ReactFiber';
import type {DOMTopLevelEventType} from 'events/TopLevelEventTypes';

import {batchedUpdates, interactiveUpdates} from 'events/ReactGenericBatching';
import {runExtractedEventsInBatch} from 'events/EventPluginHub';
import {isFiberMounted} from 'react-reconciler/reflection';
import {HostRoot} from 'shared/ReactWorkTags';

import {addEventBubbleListener, addEventCaptureListener} from './EventListener';
import getEventTarget from './getEventTarget';
import {getClosestInstanceFromNode} from '../client/ReactDOMComponentTree';
import SimpleEventPlugin from './SimpleEventPlugin';
import {getRawEventName} from './DOMTopLevelEventTypes';

const {isInteractiveTopLevelEventType} = SimpleEventPlugin;

const CALLBACK_BOOKKEEPING_POOL_SIZE = 10;
const callbackBookkeepingPool = [];

/**
 * Find the deepest React component completely containing the root of the
 * passed-in instance (for use when entire React trees are nested within each
 * other). If React trees are not nested, returns null.
 */
function findRootContainerNode(inst) {
  // TODO: It may be a good idea to cache this to prevent unnecessary DOM
  // traversal, but caching is difficult to do correctly without using a
  // mutation observer to listen for all DOM changes.
  while (inst.return) {
    inst = inst.return;
  }
  if (inst.tag !== HostRoot) {
    // This can happen if we're in a detached tree.
    return null;
  }
  // 一直找到 root节点，render方法接收的第二个参数
  return inst.stateNode.containerInfo;
}

// Used to store ancestor hierarchy in top level callback
function getTopLevelCallbackBookKeeping(
  topLevelType,
  nativeEvent,
  targetInst,
): {
  topLevelType: ?DOMTopLevelEventType,
  nativeEvent: ?AnyNativeEvent,
  targetInst: Fiber | null,
  ancestors: Array<Fiber>,
} {
  if (callbackBookkeepingPool.length) {
    const instance = callbackBookkeepingPool.pop();
    instance.topLevelType = topLevelType;
    instance.nativeEvent = nativeEvent;
    instance.targetInst = targetInst;
    return instance;
  }
  return {
    topLevelType,
    nativeEvent,
    targetInst,
    ancestors: [],
  };
}

function releaseTopLevelCallbackBookKeeping(instance) {
  instance.topLevelType = null;
  instance.nativeEvent = null;
  instance.targetInst = null;
  instance.ancestors.length = 0;
  if (callbackBookkeepingPool.length < CALLBACK_BOOKKEEPING_POOL_SIZE) {
    callbackBookkeepingPool.push(instance);
  }
}

function handleTopLevel(bookKeeping) {
  let targetInst = bookKeeping.targetInst;

  // Loop through the hierarchy, in case there's any nested components.
  // It's important that we build the array of ancestors before calling any
  // event handlers, because event handlers can modify the DOM, leading to
  // inconsistencies with ReactMount's node cache. See #1105.
  let ancestor = targetInst;
  do {
    // 如果是不存在 就push 一个null
    if (!ancestor) {
      bookKeeping.ancestors.push(ancestor);
      break;
    }
    // 如果存在 就找到 这个ancestor 的root render方法接收的第二个参数
    const root = findRootContainerNode(ancestor);
    if (!root) {
      // 如果root不存在就退出循环
      break;
    }
    // 存在就 push ancestor
    bookKeeping.ancestors.push(ancestor);
    // 正常是只会有一个root节点，但可能通过 hack的方式 在一个页面 渲染了两个react app  
    // 因为事件绑定是通过冒泡绑定到最外层的 dom上的， 所有在这里 执行getClosestInstanceFromNode是要找到 最外层的react 节点
    ancestor = getClosestInstanceFromNode(root);
  } while (ancestor);

  for (let i = 0; i < bookKeeping.ancestors.length; i++) {
    targetInst = bookKeeping.ancestors[i];
    runExtractedEventsInBatch(
      bookKeeping.topLevelType,
      targetInst,
      bookKeeping.nativeEvent,
      getEventTarget(bookKeeping.nativeEvent),
    );
  }
}

// TODO: can we stop exporting these?
export let _enabled = true;

export function setEnabled(enabled: ?boolean) {
  _enabled = !!enabled;
}

export function isEnabled() {
  return _enabled;
}

/**
 * Traps top-level events by using event bubbling.
 *
 * @param {number} topLevelType Number from `TopLevelEventTypes`.
 * @param {object} element Element on which to attach listener.
 * @return {?object} An object with a remove function which will forcefully
 *                  remove the listener.
 * @internal
 */
export function trapBubbledEvent(
  topLevelType: DOMTopLevelEventType,
  element: Document | Element,
) {
  if (!element) {
    return null;
  }
  // 要通过 Interactive 判断是否是个 Interactive 事件 Interactive（用户交互事件）
  // Interactive（用户交互事件）中 setState 的 expirationTime小 优先级高
  // 是否Interactive 绑定的事件不同
  const dispatch = isInteractiveTopLevelEventType(topLevelType)
    ? dispatchInteractiveEvent
    : dispatchEvent;

  addEventBubbleListener(
    element,
    getRawEventName(topLevelType),
    // Check if interactive and wrap in interactiveUpdates
    dispatch.bind(null, topLevelType),
  );
}

/**
 * Traps a top-level event by using event capturing.
 *
 * @param {number} topLevelType Number from `TopLevelEventTypes`.
 * @param {object} element Element on which to attach listener.
 * @return {?object} An object with a remove function which will forcefully
 *                  remove the listener.
 * @internal
 */
export function trapCapturedEvent(
  topLevelType: DOMTopLevelEventType,
  element: Document | Element,
) {
  if (!element) {
    return null;
  }
  // dispatchEvent 和 dispatchInteractiveEvent 的区别就是 中间是否经历了 interactiveUpdates 这个方法
  const dispatch = isInteractiveTopLevelEventType(topLevelType)
    ? dispatchInteractiveEvent
    : dispatchEvent;
  addEventCaptureListener(
    element,
    getRawEventName(topLevelType),
    // Check if interactive and wrap in interactiveUpdates
    // topLevelType: onChange
    dispatch.bind(null, topLevelType),
  );
}

function dispatchInteractiveEvent(topLevelType, nativeEvent) {
  interactiveUpdates(dispatchEvent, topLevelType, nativeEvent);
}

export function dispatchEvent(
  topLevelType: DOMTopLevelEventType,
  nativeEvent: AnyNativeEvent,
) {
  if (!_enabled) {
    return;
  }

  // 兼容不同浏览器 的pollfill过程， 返回触发的 target
  const nativeEventTarget = getEventTarget(nativeEvent);
  // 通过 一个 dom 节点 返回最近的 HostComponent，HostText  （是个fiber）
  let targetInst = getClosestInstanceFromNode(nativeEventTarget);
  if (
    targetInst !== null &&
    typeof targetInst.tag === 'number' && // tag 都是用二进制存储的， 通过这个判断是否是一个fiber对象
    !isFiberMounted(targetInst) // 判断当前 fiber节点对应的dom节点是否已经被挂载了
  ) {
    // If we get an event (ex: img onload) before committing that
    // component's mount, ignore it for now (that is, treat it as if it was an
    // event on a non-React tree). We might also consider queueing events and
    // dispatching them after the mount.
    // 没被挂载 target 就为null
    targetInst = null;
  }

  // bookKeeping 其实是 一个用来存储变量的对象
  const bookKeeping = getTopLevelCallbackBookKeeping(
    topLevelType,
    nativeEvent,
    targetInst,
  );

  try {
    // Event queue being processed in the same cycle allows
    // `preventDefault`.
    // batchedUpdates 就是执行handleTopLevel(bookKeeping)  和 controlled inputs相关的
    batchedUpdates(handleTopLevel, bookKeeping);
  } finally {
    releaseTopLevelCallbackBookKeeping(bookKeeping);
  }
}
