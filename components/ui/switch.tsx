'use client';
import { Switch as SwitchPrimitive } from '@base-ui/react/switch';
import { cn } from '@/lib/utils';
export function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root {...props} className={cn('astro-switch', className)}>
      <SwitchPrimitive.Thumb className="astro-switch-thumb" />
    </SwitchPrimitive.Root>
  );
}
