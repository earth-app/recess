<template>
	<IonSelect
		:label="label"
		label-placement="stacked"
		interface="popover"
		fill="outline"
		:value="modelValue ?? OFF"
		class="text-sm!"
		@ion-change="onChange"
	>
		<IonSelectOption :value="OFF">Off</IonSelectOption>
		<IonSelectOption
			v-for="option in options"
			:key="option"
			:value="option"
		>
			{{ option }}
		</IonSelectOption>
	</IonSelect>
</template>

<script setup lang="ts">
defineProps<{
	label: string;
	options: readonly string[];
	modelValue: string | null;
}>();

const emit = defineEmits<{ 'update:modelValue': [string | null] }>();

// a sentinel rather than null, because IonSelect treats null as "nothing selected"
// and would render blank instead of showing the off state
const OFF = '__off__';

function onChange(event: Event) {
	const value = String((event as CustomEvent<{ value?: unknown }>).detail?.value ?? OFF);
	emit('update:modelValue', value === OFF ? null : value);
}
</script>
