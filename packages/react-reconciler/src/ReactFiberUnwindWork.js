/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Fiber} from './ReactFiber';
import type {FiberRoot} from './ReactFiberRoot';
import type {ExpirationTime} from './ReactFiberExpirationTime';
import type {CapturedValue} from './ReactCapturedValue';
import type {Update} from './ReactUpdateQueue';
import type {Thenable} from './ReactFiberScheduler';
import type {SuspenseState} from './ReactFiberSuspenseComponent';

import {unstable_wrap as Schedule_tracing_wrap} from 'scheduler/tracing';
import getComponentName from 'shared/getComponentName';
import warningWithoutStack from 'shared/warningWithoutStack';
import {
  ClassComponent,
  HostRoot,
  HostComponent,
  HostPortal,
  ContextProvider,
  SuspenseComponent,
  IncompleteClassComponent,
} from 'shared/ReactWorkTags';
import {
  DidCapture,
  Incomplete,
  NoEffect,
  ShouldCapture,
  Callback as CallbackEffect,
  LifecycleEffectMask,
} from 'shared/ReactSideEffectTags';
import {enableSchedulerTracing} from 'shared/ReactFeatureFlags';
import {ConcurrentMode} from './ReactTypeOfMode';
import {shouldCaptureSuspense} from './ReactFiberSuspenseComponent';

import {createCapturedValue} from './ReactCapturedValue';
import {
  enqueueCapturedUpdate,
  createUpdate,
  CaptureUpdate,
} from './ReactUpdateQueue';
import {logError} from './ReactFiberCommitWork';
import {popHostContainer, popHostContext} from './ReactFiberHostContext';
import {
  isContextProvider as isLegacyContextProvider,
  popContext as popLegacyContext,
  popTopLevelContextObject as popTopLevelLegacyContextObject,
} from './ReactFiberContext';
import {popProvider} from './ReactFiberNewContext';
import {
  renderDidSuspend,
  renderDidError,
  onUncaughtError,
  markLegacyErrorBoundaryAsFailed,
  isAlreadyFailedLegacyErrorBoundary,
  retrySuspendedRoot,
} from './ReactFiberScheduler';
import {NoWork, Sync} from './ReactFiberExpirationTime';

import invariant from 'shared/invariant';
import maxSigned31BitInt from './maxSigned31BitInt';
import {
  expirationTimeToMs,
  LOW_PRIORITY_EXPIRATION,
} from './ReactFiberExpirationTime';
import {findEarliestOutstandingPriorityLevel} from './ReactFiberPendingPriority';
import {reconcileChildren} from './ReactFiberBeginWork';

function createRootErrorUpdate(
  fiber: Fiber,
  errorInfo: CapturedValue<mixed>,
  expirationTime: ExpirationTime,
): Update<mixed> {
  const update = createUpdate(expirationTime);
  // Unmount the root by rendering null.
  update.tag = CaptureUpdate;
  // Caution: React DevTools currently depends on this property
  // being called "element".
  update.payload = {element: null};
  const error = errorInfo.value;
  update.callback = () => {
    onUncaughtError(error);
    logError(fiber, errorInfo);
  };
  return update;
}

function createClassErrorUpdate(
  fiber: Fiber,
  errorInfo: CapturedValue<mixed>,
  expirationTime: ExpirationTime,
): Update<mixed> {
  const update = createUpdate(expirationTime);
  update.tag = CaptureUpdate;
  const getDerivedStateFromError = fiber.type.getDerivedStateFromError;
  if (typeof getDerivedStateFromError === 'function') {
    const error = errorInfo.value;
    update.payload = () => {
      return getDerivedStateFromError(error);
    };
  }

  const inst = fiber.stateNode;
  if (inst !== null && typeof inst.componentDidCatch === 'function') {
    update.callback = function callback() {
      if (typeof getDerivedStateFromError !== 'function') {
        // To preserve the preexisting retry behavior of error boundaries,
        // we keep track of which ones already failed during this batch.
        // This gets reset before we yield back to the browser.
        // TODO: Warn in strict mode if getDerivedStateFromError is
        // not defined.
        markLegacyErrorBoundaryAsFailed(this);
      }
      const error = errorInfo.value;
      const stack = errorInfo.stack;
      logError(fiber, errorInfo);
      this.componentDidCatch(error, {
        componentStack: stack !== null ? stack : '',
      });
      if (__DEV__) {
        if (typeof getDerivedStateFromError !== 'function') {
          // If componentDidCatch is the only error boundary method defined,
          // then it needs to call setState to recover from errors.
          // If no state update is scheduled then the boundary will swallow the error.
          warningWithoutStack(
            fiber.expirationTime === Sync,
            '%s: Error boundaries should implement getDerivedStateFromError(). ' +
              'In that method, return a state update to display an error message or fallback UI.',
            getComponentName(fiber.type) || 'Unknown',
          );
        }
      }
    };
  }
  return update;
}

// 抛出错误
function throwException(
  root: FiberRoot,
  returnFiber: Fiber,
  sourceFiber: Fiber,
  value: mixed,
  renderExpirationTime: ExpirationTime,
) {
  // The source fiber did not complete.
  sourceFiber.effectTag |= Incomplete;
  // Its effect list is no longer valid.
  sourceFiber.firstEffect = sourceFiber.lastEffect = null;

  if ( // 和 suspense 相关的代码 要看了
    value !== null &&
    typeof value === 'object' &&
    typeof value.then === 'function'
  ) {
    // This is a thenable.
    const thenable: Thenable = (value: any);

    // Find the earliest timeout threshold of all the placeholders in the
    // ancestor path. We could avoid this traversal by storing the thresholds on
    // the stack, but we choose not to because we only hit this path if we're
    // IO-bound (i.e. if something suspends). Whereas the stack is used even in
    // the non-IO- bound case.
    let workInProgress = returnFiber;
    let earliestTimeoutMs = -1;
    let startTimeMs = -1;
    do {
      if (workInProgress.tag === SuspenseComponent) {
        // 向上寻找所有 suspenseComponent
        const current = workInProgress.alternate;
        if (current !== null) {
          const currentState: SuspenseState | null = current.memoizedState;
          // 如果是第一次渲染 currentState = null 不会走下面这个判断
          if (currentState !== null && currentState.didTimeout) {
            // Reached a boundary that already timed out. Do not search
            // any further.
            const timedOutAt = currentState.timedOutAt;
            startTimeMs = expirationTimeToMs(timedOutAt);
            // Do not search any further.
            break;
          }
        }
        let timeoutPropMs = workInProgress.pendingProps.maxDuration;
        // 通过传入的props 对 earliestTimeoutMs 进行赋值
        if (typeof timeoutPropMs === 'number') {
          if (timeoutPropMs <= 0) {
            earliestTimeoutMs = 0;
          } else if (
            earliestTimeoutMs === -1 ||
            timeoutPropMs < earliestTimeoutMs // 因为 suspense组件也是可以存在嵌套的 向上找到 maxDuration 最小的那个值
          ) {
            earliestTimeoutMs = timeoutPropMs;
          }
        }
      }
      workInProgress = workInProgress.return;
    } while (workInProgress !== null);

    // Schedule the nearest Suspense to re-render the timed out view.
    workInProgress = returnFiber;
    do {
      // 再进行一次循环
      // 寻找 suspenseComponent 并且是 shouldCaptureSuspense
      if (
        workInProgress.tag === SuspenseComponent &&
        shouldCaptureSuspense(workInProgress.alternate, workInProgress) // 现在 nextState = null 知道是 true
      ) {
        // Found the nearest boundary.

        // If the boundary is not in concurrent mode, we should not suspend, and
        // likewise, when the promise resolves, we should ping synchronously.
        const pingTime =
          (workInProgress.mode & ConcurrentMode) === NoEffect // 当前是否处于 concurrentMode 是的话就是 renderExpirationTime 不属于concurrentMode 就是sync
            ? Sync
            : renderExpirationTime;

        // Attach a listener to the promise to "ping" the root and retry.
        // onResolveOrReject 是后面 promise resolve 之后会调用的那个方法
        let onResolveOrReject = retrySuspendedRoot.bind(
          null,
          root,
          workInProgress,
          sourceFiber,
          pingTime,
        );
        if (enableSchedulerTracing) {
          onResolveOrReject = Schedule_tracing_wrap(onResolveOrReject);
        }
        // resolve 和 reject 都会调用这两种方法
        thenable.then(onResolveOrReject, onResolveOrReject);

        // If the boundary is outside of concurrent mode, we should *not*
        // suspend the commit. Pretend as if the suspended component rendered
        // null and keep rendering. In the commit phase, we'll schedule a
        // subsequent synchronous update to re-render the Suspense.
        //
        // Note: It doesn't matter whether the component that suspended was
        // inside a concurrent mode tree. If the Suspense is outside of it, we
        // should *not* suspend the commit.
        
        // 如果不处于 ConcurrentMode 会执行这个 if 的内容
        if ((workInProgress.mode & ConcurrentMode) === NoEffect) {
          // 会在 effectTag 增加 一个 CallbackEffect
          workInProgress.effectTag |= CallbackEffect;

          // Unmount the source fiber's children
          const nextChildren = null;
          // 调和子节点
          reconcileChildren(
            sourceFiber.alternate, // 这里用的是 sourceFiber  不是workInProgress（也就不是suspense 组件）  而是 throw 那个promise 的组件 这里把它渲染成null
            sourceFiber,
            nextChildren,
            renderExpirationTime,
          );
          sourceFiber.effectTag &= ~Incomplete;

          if (sourceFiber.tag === ClassComponent) {
            // 如果是 ClassComponent 组件
            // We're going to commit this fiber even though it didn't complete.
            // But we shouldn't call any lifecycle methods or callbacks. Remove
            // all lifecycle effect tags.
            // 把生命周期相关的 effect 全部去掉（变成0再&不可能还存在）
            sourceFiber.effectTag &= ~LifecycleEffectMask;
            const current = sourceFiber.alternate;
            if (current === null) {
              // This is a new mount. Change the tag so it's not mistaken for a
              // completed component. For example, we should not call
              // componentWillUnmount if it is deleted.
              sourceFiber.tag = IncompleteClassComponent;
            }
          }

          // Exit without suspending.
          // 如果是同步sync模式下 设置这些内容就直接 return 了
          // 去看 unwindWork 执行suspenseComponent 这个组件是没有带 shouldCapture的   
          // unwindWork 中会return null  ---> completeUnitOfWork 的时候 next = null 就不会对这个组件再次进行beginWork的操作  
          // 也就是这个组件 和它的 subtree 已经渲染完了 那么整棵树 就等着提交就可以了
          // 因为 throw 的是 promisse 也就不会进入 nextDidError 错误处理里面
          // 就直接进入 到commit 阶段， 在commit 里面会对 suspenseComponent 进行 特殊的操作
          return;
        }

        // Confirmed that the boundary is in a concurrent mode tree. Continue
        // with the normal suspend path.

        let absoluteTimeoutMs;
        if (earliestTimeoutMs === -1) {
          // If no explicit threshold is given, default to an abitrarily large
          // value. The actual size doesn't matter because the threshold for the
          // whole tree will be clamped to the expiration time.
          absoluteTimeoutMs = maxSigned31BitInt;
        } else {
          if (startTimeMs === -1) {
            // This suspend happened outside of any already timed-out
            // placeholders. We don't know exactly when the update was
            // scheduled, but we can infer an approximate start time from the
            // expiration time. First, find the earliest uncommitted expiration
            // time in the tree, including work that is suspended. Then subtract
            // the offset used to compute an async update's expiration time.
            // This will cause high priority (interactive) work to expire
            // earlier than necessary, but we can account for this by adjusting
            // for the Just Noticeable Difference.
            const earliestExpirationTime = findEarliestOutstandingPriorityLevel(
              root,
              renderExpirationTime,
            );
            const earliestExpirationTimeMs = expirationTimeToMs(
              earliestExpirationTime,
            );
            startTimeMs = earliestExpirationTimeMs - LOW_PRIORITY_EXPIRATION;
          }
          absoluteTimeoutMs = startTimeMs + earliestTimeoutMs;
        }

        // Mark the earliest timeout in the suspended fiber's ancestor path.
        // After completing the root, we'll take the largest of all the
        // suspended fiber's timeouts and use it to compute a timeout for the
        // whole tree.
        renderDidSuspend(root, absoluteTimeoutMs, renderExpirationTime);

        workInProgress.effectTag |= ShouldCapture;
        workInProgress.expirationTime = renderExpirationTime;
        return;
      }
      // This boundary already captured during this render. Continue to the next
      // boundary.
      workInProgress = workInProgress.return;
    } while (workInProgress !== null);
    // No boundary was found. Fallthrough to error mode.
    value = new Error(
      'An update was suspended, but no placeholder UI was provided.',
    );
  }

  // We didn't find a boundary that could handle this type of exception. Start
  // over and traverse parent path again, this time treating the exception
  // as an error.
  renderDidError(); 
  // nextRenderDidError=true
  // createCapturedValue 返回 
  // {
  //   value,
  //   source,
  //   stack: getStackByFiberInDevAndProd(source), // 错误具体信息 文件地址， 行等
  // };
  value = createCapturedValue(value, sourceFiber);
  let workInProgress = returnFiber;
  do {
    switch (workInProgress.tag) {
      case HostRoot: {
        // 在没有错误处理函数的情况下， 最后会通过在rootFiber节点上创建 sideEffectTag 是capture的更新进行处理
        const errorInfo = value;
        workInProgress.effectTag |= ShouldCapture;
        workInProgress.expirationTime = renderExpirationTime;
        // createRootErrorUpdate 里面也是调用的crateUpdate 只是它的effectTag是captureUpdate
        const update = createRootErrorUpdate(
          workInProgress,
          errorInfo,
          renderExpirationTime,
        );
        enqueueCapturedUpdate(workInProgress, update);
        return;
      }
      case ClassComponent:
        // Capture and retry
        const errorInfo = value;
        const ctor = workInProgress.type;
        const instance = workInProgress.stateNode;
        if (// 当是ClassComponent存在 错误处理函数的时候
          (workInProgress.effectTag & DidCapture) === NoEffect &&
          (typeof ctor.getDerivedStateFromError === 'function' ||
            (instance !== null &&
              typeof instance.componentDidCatch === 'function' &&
              !isAlreadyFailedLegacyErrorBoundary(instance)))
        ) {
          workInProgress.effectTag |= ShouldCapture;
          workInProgress.expirationTime = renderExpirationTime;
          // Schedule the error boundary to re-render using updated state
          // boundary：边界、范围
          // 调度 错误的boundary 根据update 重新渲染  里面有怎么调用错误处理函数的过程
          // 里面也是调用的crateUpdate 只是它的effectTag是captureUpdate
          const update = createClassErrorUpdate(
            workInProgress,
            errorInfo,
            renderExpirationTime,
          );
          enqueueCapturedUpdate(workInProgress, update);
          return;
        }
        break;
      default:
        break;
    }
    workInProgress = workInProgress.return;
  } while (workInProgress !== null);
}

function unwindWork(
  workInProgress: Fiber,
  renderExpirationTime: ExpirationTime,
) {
  // 也需要跟根据组件类型 进行类似completeWork的操作， 1pop context 2 HostComponent更新创建 3 事件监听
  // 但是和 completeWork最大区别是 会判断ShouldCapture 
  // 如果有ShouldCapture 会将它去掉 增加 DidCapture
  // return 的也有区别 
  // completeWork return的都是workInProgress 
  // unwindWork 判断是return null  还是 return workInProgress
  switch (workInProgress.tag) {
    case ClassComponent: {
      const Component = workInProgress.type;
      if (isLegacyContextProvider(Component)) {
        popLegacyContext(workInProgress);
      }
      const effectTag = workInProgress.effectTag;
      if (effectTag & ShouldCapture) {
        workInProgress.effectTag = (effectTag & ~ShouldCapture) | DidCapture;
        return workInProgress;
      }
      return null;
    }
    case HostRoot: {
      popHostContainer(workInProgress);
      popTopLevelLegacyContextObject(workInProgress);
      const effectTag = workInProgress.effectTag;
      invariant(
        (effectTag & DidCapture) === NoEffect,
        'The root failed to unmount after an error. This is likely a bug in ' +
          'React. Please file an issue.',
      );
      workInProgress.effectTag = (effectTag & ~ShouldCapture) | DidCapture;
      return workInProgress;
    }
    case HostComponent: {
      popHostContext(workInProgress);
      return null;
    }
    case SuspenseComponent: {
      const effectTag = workInProgress.effectTag;
      if (effectTag & ShouldCapture) {
        workInProgress.effectTag = (effectTag & ~ShouldCapture) | DidCapture;
        // Captured a suspense effect. Set the boundary's `alreadyCaptured`
        // state to true so we know to render the fallback.
        const current = workInProgress.alternate;
        const currentState: SuspenseState | null =
          current !== null ? current.memoizedState : null;
        let nextState: SuspenseState | null = workInProgress.memoizedState;
        if (nextState === null) {
          // No existing state. Create a new object.
          nextState = {
            alreadyCaptured: true,
            didTimeout: false,
            timedOutAt: NoWork,
          };
        } else if (currentState === nextState) {
          // There is an existing state but it's the same as the current tree's.
          // Clone the object.
          nextState = {
            alreadyCaptured: true,
            didTimeout: nextState.didTimeout,
            timedOutAt: nextState.timedOutAt,
          };
        } else {
          // Already have a clone, so it's safe to mutate.
          nextState.alreadyCaptured = true;
        }
        workInProgress.memoizedState = nextState;
        // Re-render the boundary.
        return workInProgress;
      }
      return null;
    }
    case HostPortal:
      popHostContainer(workInProgress);
      return null;
    case ContextProvider:
      popProvider(workInProgress);
      return null;
    default:
      return null;
  }
}

function unwindInterruptedWork(interruptedWork: Fiber) {
  switch (interruptedWork.tag) {
    case ClassComponent: {
      const childContextTypes = interruptedWork.type.childContextTypes;
      if (childContextTypes !== null && childContextTypes !== undefined) {
        popLegacyContext(interruptedWork);
      }
      break;
    }
    case HostRoot: {
      popHostContainer(interruptedWork);
      popTopLevelLegacyContextObject(interruptedWork);
      break;
    }
    case HostComponent: {
      popHostContext(interruptedWork);
      break;
    }
    case HostPortal:
      popHostContainer(interruptedWork);
      break;
    case ContextProvider:
      popProvider(interruptedWork);
      break;
    default:
      break;
  }
}

export {
  throwException,
  unwindWork,
  unwindInterruptedWork,
  createRootErrorUpdate,
  createClassErrorUpdate,
};
