// useInfiniteScroll — IntersectionObserver 기반 클라이언트 페이지네이션.
//
// 사용:
//   const { visibleItems, sentinelRef, hasMore, reset } = useInfiniteScroll(allItems, 20);
//
//   <div v-for="i in visibleItems" :key="i.id">...</div>
//   <div v-if="hasMore" ref="sentinelRef" class="h-px" />
//
// allItems가 바뀌면 limit은 그대로 (스크롤 위치 유지). 외부에서 reset() 필요.

import { computed, ref, onMounted, onUnmounted, watch, type Ref } from 'vue';

export function useInfiniteScroll<T>(
  allItems: Ref<T[]> | (() => T[]),
  pageSize = 20,
) {
  const getAll = (): T[] => (typeof allItems === 'function' ? allItems() : allItems.value);
  const limit = ref<number>(pageSize);
  const sentinelRef = ref<HTMLElement | null>(null);
  let observer: IntersectionObserver | null = null;

  const visibleItems = computed<T[]>(() => getAll().slice(0, limit.value));
  const hasMore = computed<boolean>(() => limit.value < getAll().length);

  function loadMore() {
    if (!hasMore.value) return;
    limit.value = Math.min(limit.value + pageSize, getAll().length);
  }

  function reset() { limit.value = pageSize; }

  function setupObserver() {
    if (typeof window === 'undefined') return;
    if (observer) observer.disconnect();
    if (!sentinelRef.value) return;
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) loadMore();
        }
      },
      { rootMargin: '120px' }, // 끝에 120px 전부터 미리 로드
    );
    observer.observe(sentinelRef.value);
  }

  // sentinel이 v-if로 추후 mount될 수도 있으니 watch
  watch(sentinelRef, () => setupObserver(), { flush: 'post' });

  onMounted(() => setupObserver());
  onUnmounted(() => observer?.disconnect());

  return { visibleItems, sentinelRef, hasMore, loadMore, reset };
}
