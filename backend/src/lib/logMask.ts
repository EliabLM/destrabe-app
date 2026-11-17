/** `+573001234567` → `+57******4567`: teléfonos enmascarados en logs (DCC-05). */
export function maskPhone(phone: string): string {
  if (phone.length <= 7) return '*'.repeat(phone.length);
  return `${phone.slice(0, 3)}${'*'.repeat(phone.length - 7)}${phone.slice(-4)}`;
}
