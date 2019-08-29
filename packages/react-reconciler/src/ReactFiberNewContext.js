/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {ReactContext} from 'shared/ReactTypes';
import type {Fiber} from './ReactFiber';
import type {StackCursor} from './ReactFiberStack';
import type {ExpirationTime} from './ReactFiberExpirationTime';

export type ContextDependency<T> = {
  context: ReactContext<T>,
  observedBits: number,
  next: ContextDependency<mixed> | null,
};

import warningWithoutStack from 'shared/warningWithoutStack';
import {isPrimaryRenderer} from './ReactFiberHostConfig';
import {createCursor, push, pop} from './ReactFiberStack';
import MAX_SIGNED_31_BIT_INT from './maxSigned31BitInt';
import {NoWork} from './ReactFiberExpirationTime';
import {ContextProvider, ClassComponent} from 'shared/ReactWorkTags';

import invariant from 'shared/invariant';
import warning from 'shared/warning';
import {
  createUpdate,
  enqueueUpdate,
  ForceUpdate,
} from 'react-reconciler/src/ReactUpdateQueue';

const valueCursor: StackCursor<mixed> = createCursor(null);

let rendererSigil;
if (__DEV__) {
  // Use this to detect multiple renderers using the same context
  rendererSigil = {};
}

let currentlyRenderingFiber: Fiber | null = null;
let lastContextDependency: ContextDependency<mixed> | null = null;
let lastContextWithAllBitsObserved: ReactContext<any> | null = null;

export function resetContextDependences(): void {
  // This is called right before React yields execution, to ensure `readContext`
  // cannot be called outside the render phase.
  currentlyRenderingFiber = null;
  lastContextDependency = null;
  lastContextWithAllBitsObserved = null;
}


export function pushProvider<T>(providerFiber: Fiber, nextValue: T): void {
  const context: ReactContext<T> = providerFiber.type._context;

  if (isPrimaryRenderer) {
    // 将当前的context值（context._currentValue） 推入 stack中
    push(valueCursor, context._currentValue, providerFiber);

    // 将最新的 context 值赋值给当前 context(consumer)
    context._currentValue = nextValue;
    if (__DEV__) {
      warningWithoutStack(
        context._currentRenderer === undefined ||
          context._currentRenderer === null ||
          context._currentRenderer === rendererSigil,
        'Detected multiple renderers concurrently rendering the ' +
          'same context provider. This is currently unsupported.',
      );
      context._currentRenderer = rendererSigil;
    }
  } else {
    push(valueCursor, context._currentValue2, providerFiber);

    context._currentValue2 = nextValue;
    if (__DEV__) {
      warningWithoutStack(
        context._currentRenderer2 === undefined ||
          context._currentRenderer2 === null ||
          context._currentRenderer2 === rendererSigil,
        'Detected multiple renderers concurrently rendering the ' +
          'same context provider. This is currently unsupported.',
      );
      context._currentRenderer2 = rendererSigil;
    }
  }
}

export function popProvider(providerFiber: Fiber): void {
  const currentValue = valueCursor.current;

  pop(valueCursor, providerFiber);

  const context: ReactContext<any> = providerFiber.type._context;
  if (isPrimaryRenderer) {
    context._currentValue = currentValue;
  } else {
    context._currentValue2 = currentValue;
  }
}

// 计算 新旧值是否相等，相等 返回 0
export function calculateChangedBits<T>(
  context: ReactContext<T>,
  newValue: T,
  oldValue: T,
) {
  // Use Object.is to compare the new context value to the old value. Inlined
  // Object.is polyfill.
  // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/is
  // ES6 Object.is(a, b) 比较两个值是否全等
  // 和 全等===的 区别在于
  // Object.is(-0, +0) false   Object.is(NaN, NaN) true  这个两个是有区别的
  if (
    (oldValue === newValue &&
      (oldValue !== 0 || 1 / oldValue === 1 / (newValue: any))) ||
    (oldValue !== oldValue && newValue !== newValue) // eslint-disable-line no-self-compare
  ) {
    // No change
    return 0;
  } else {
    const changedBits =
      typeof context._calculateChangedBits === 'function'
        ? context._calculateChangedBits(oldValue, newValue)
        : MAX_SIGNED_31_BIT_INT;

    if (__DEV__) {
      warning(
        (changedBits & MAX_SIGNED_31_BIT_INT) === changedBits,
        'calculateChangedBits: Expected the return value to be a ' +
          '31-bit integer. Instead received: %s',
        changedBits,
      );
    }
    // | 0 取整
    return changedBits | 0;
  }
}

// 将 当前 provider这个组件每个节点的子节点都遍历到  
// 并且找到具有fiber.firstContextDependency 给它创建更新的过程
// 并且更新 那个fiber 和父链上的 expirationTime 
export function propagateContextChange(
  workInProgress: Fiber,
  context: ReactContext<mixed>,
  changedBits: number,
  renderExpirationTime: ExpirationTime,
): void {
  // 获取第一个子节点
  let fiber = workInProgress.child;
  if (fiber !== null) {
    // Set the return pointer of the child to the work-in-progress fiber.
    fiber.return = workInProgress;
  }
  // 将 当前 provider这个组件每个节点的子节点都遍历到  
  // 并且找到具有fiber.firstContextDependency 给它创建更新的过程
  while (fiber !== null) {
    let nextFiber;
    // Visit this fiber.
    let dependency = fiber.firstContextDependency;
    if (dependency !== null) {
      do {
        // Check if the context matches.
        if (
          dependency.context === context && // 说明当前遍历的组件 是依赖于当前的context  如果context 变化 它需要重新渲染
          (dependency.observedBits & changedBits) !== 0 // changedBits 是32都是1  只要observedBits 不是0 就不会等于1  说明他们有相交的部分  也说明它依赖的部分也变化了
        ) {
          // Match! Schedule an update on this fiber.
          if (fiber.tag === ClassComponent) {
            // Schedule a force update on the work-in-progress.
            // 因为 只有 setState能更新组件 但是这里 使用过的 context改变了 必须要进行更新
            // 主动添加一个 update 更新这个ClassComponent  update.tag 是forceUpdate  强制更新一下
            const update = createUpdate(renderExpirationTime);
            update.tag = ForceUpdate;
            // TODO: Because we don't have a work-in-progress, this will add the
            // update to the current fiber, too, which means it will persist even if
            // this render is thrown away. Since it's a race condition, not sure it's
            // worth fixing.
            enqueueUpdate(fiber, update);
          }

          if (
            fiber.expirationTime === NoWork ||
            fiber.expirationTime > renderExpirationTime
          ) {
            // 如果这个 fiber.expirationTime 的expirationTime 的优先级是低于这次 当前正在渲染的expirtionTime 
            // 那就将当前 要渲染的expirationTime 赋值给 它（fiber）让它在这次肯定被更新到
            fiber.expirationTime = renderExpirationTime;
          }
          // 上面是在workInProcress上被设置
          // 下面是在 current上设置 ，它们俩应该是同步的
          let alternate = fiber.alternate;
          if (
            alternate !== null &&
            (alternate.expirationTime === NoWork ||
              alternate.expirationTime > renderExpirationTime)
          ) {
            alternate.expirationTime = renderExpirationTime;
          }
          // Update the child expiration time of all the ancestors, including
          // the alternates.
          let node = fiber.return;
          // 这里修改的 expirtionTime 那么它父链上的值都有可能被改变 ，
          // 这里是重新设置父链上的expirationTime
          while (node !== null) {
            alternate = node.alternate;
            if (
              node.childExpirationTime === NoWork ||
              node.childExpirationTime > renderExpirationTime
            ) {
              node.childExpirationTime = renderExpirationTime;
              if (
                alternate !== null &&
                (alternate.childExpirationTime === NoWork ||
                  alternate.childExpirationTime > renderExpirationTime)
              ) {
                alternate.childExpirationTime = renderExpirationTime;
              }
            } else if (
              alternate !== null &&
              (alternate.childExpirationTime === NoWork ||
                alternate.childExpirationTime > renderExpirationTime)
            ) {
              alternate.childExpirationTime = renderExpirationTime;
            } else {
              // Neither alternate was updated, which means the rest of the
              // ancestor path already has sufficient priority.
              break;
            }
            node = node.return;
          }
        }
        nextFiber = fiber.child;
        dependency = dependency.next;
      } while (dependency !== null);
    } else if (fiber.tag === ContextProvider) {
      // Don't scan deeper if this is a matching provider
      nextFiber = fiber.type === workInProgress.type ? null : fiber.child;
    } else {
      // Traverse down.
      nextFiber = fiber.child;
    }

    if (nextFiber !== null) {
      // Set the return pointer of the child to the work-in-progress fiber.
      nextFiber.return = fiber;
    } else {
      // No child. Traverse to next sibling.
      nextFiber = fiber;
      while (nextFiber !== null) {
        if (nextFiber === workInProgress) {
          // We're back to the root of this subtree. Exit.
          nextFiber = null;
          break;
        }
        let sibling = nextFiber.sibling;
        if (sibling !== null) {
          // Set the return pointer of the sibling to the work-in-progress fiber.
          sibling.return = nextFiber.return;
          nextFiber = sibling;
          break;
        }
        // No more siblings. Traverse up.
        nextFiber = nextFiber.return;
      }
    }
    fiber = nextFiber;
  }
}

export function prepareToReadContext(
  workInProgress: Fiber,
  renderExpirationTime: ExpirationTime,
): void {
  currentlyRenderingFiber = workInProgress;
  lastContextDependency = null;
  lastContextWithAllBitsObserved = null;

  // Reset the work-in-progress list
  workInProgress.firstContextDependency = null;
}

// 返回最新 context 的值
export function readContext<T>(
  context: ReactContext<T>,
  observedBits: void | number | boolean,
): T {
  if (lastContextWithAllBitsObserved === context) {
    // Nothing to do. We already observe everything in this context.
  } else if (observedBits === false || observedBits === 0) {
    // Do not observe any updates.
  } else {
    let resolvedObservedBits; // Avoid deopting on observable arguments or heterogeneous types.
    if (
      typeof observedBits !== 'number' ||
      observedBits === MAX_SIGNED_31_BIT_INT
    ) {
      // Observe all updates.
      lastContextWithAllBitsObserved = ((context: any): ReactContext<mixed>);
      resolvedObservedBits = MAX_SIGNED_31_BIT_INT;
    } else {
      resolvedObservedBits = observedBits;
    }

    let contextItem = {
      context: ((context: any): ReactContext<mixed>),
      observedBits: resolvedObservedBits,
      next: null,
    };

    if (lastContextDependency === null) {
      invariant(
        currentlyRenderingFiber !== null,
        'Context can only be read while React is ' +
          'rendering, e.g. inside the render method or getDerivedStateFromProps.',
      );
      // This is the first dependency in the list
      // 这里是 针对 classComponent 它只有一个context 所以只需要定义 主键的 firstContextDependency
      currentlyRenderingFiber.firstContextDependency = lastContextDependency = contextItem;
    } else {
      // Append a new context item.
      // 但是 使用 Hooks API 的 functionComponent 能使用多个context  所以才对 contextDependency  使用链表结构
      lastContextDependency = lastContextDependency.next = contextItem;
    }
  }
  return isPrimaryRenderer ? context._currentValue : context._currentValue2;
}
