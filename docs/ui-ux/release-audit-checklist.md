# Release Audit Checklist

Checklist minimo antes de compilar o desplegar cambios visuales.

## Light / Dark

- [ ] la pantalla funciona en modo dia
- [ ] la pantalla funciona en modo noche
- [ ] no hay fondos blancos duros sin variante `dark:`
- [ ] textos secundarios siguen siendo legibles en dark
- [ ] bordes y separadores siguen siendo visibles en ambos temas

## Jerarquia

- [ ] existe un CTA principal claro
- [ ] los bloques tienen roles entendibles
- [ ] el usuario distingue contexto, editor y resultado
- [ ] los elementos importantes destacan sin depender solo del color
- [ ] no hay bloques que expliquen decisiones internas del equipo o conceptos de diseño al usuario final
- [ ] la pantalla podria defenderse con menos elementos si fuera necesario

## Responsive

- [ ] no hay scroll horizontal en mobile
- [ ] los paneles complejos colapsan con orden logico
- [ ] inputs y botones siguen siendo tocables en pantallas chicas
- [ ] los bloques con altura fija no rompen el contenido

## Interaccion

- [ ] hover, focus y disabled son claros
- [ ] loading no rompe layout
- [ ] los scrolls internos se comportan bien
- [ ] no hay acciones destructivas demasiado cerca de acciones primarias

## Calidad visual

- [ ] no hay placeholders visuales evidentes
- [ ] cards, sombras y radios siguen una misma familia
- [ ] no hay mezcla arbitraria de estilos
- [ ] la experiencia se siente producto y no panel tecnico
- [ ] la interfaz se siente simple y obvia en pocos segundos
