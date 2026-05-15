<script setup lang="ts">
import { ref } from 'vue';
import { HelpCircle } from 'lucide-vue-next';
import Modal from '@/components/ui/Modal.vue';
import Button from '@/components/ui/Button.vue';

defineProps<{
  title: string;
  description: string;
}>();

const open = ref(false);
</script>

<template>
  <button
    type="button"
    class="-ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground transition hover:text-foreground"
    aria-label="도움말"
    @click.stop="open = true"
  >
    <HelpCircle class="h-3.5 w-3.5" />
  </button>
  <Modal :open="open" :title="title" @close="open = false">
    <p class="text-sm leading-relaxed text-muted-foreground">{{ description }}</p>
    <div class="mt-5">
      <Button variant="primary" class="w-full" @click="open = false">알겠어요</Button>
    </div>
  </Modal>
</template>
