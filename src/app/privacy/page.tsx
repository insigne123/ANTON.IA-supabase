import Link from 'next/link';
import { ArrowLeft, Shield } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { legalConfig } from '@/lib/legal-config';

export default function PrivacyPolicyPage() {
  const contactEmail = legalConfig.privacyContactEmail;

  return (
    <main className="min-h-screen bg-background px-4 py-10 md:px-10">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <Button asChild variant="ghost" className="gap-2">
            <Link href="/login">
              <ArrowLeft className="h-4 w-4" />
              Volver a acceso
            </Link>
          </Button>
          <Button asChild variant="secondary" className="gap-2">
            <Link href="/privacy/request">
              <Shield className="h-4 w-4" />
              Solicitar derechos
            </Link>
          </Button>
          <Button asChild variant="outline" className="gap-2">
            <Link href="/privacy/extension">
              <Shield className="h-4 w-4" />
              Ver política de la extensión
            </Link>
          </Button>
        </div>

        <Card>
          <CardHeader>
            <h1 className="text-3xl font-bold">Política de Privacidad - Plataforma {legalConfig.productName}</h1>
            <p className="text-muted-foreground">Última actualización: {legalConfig.lastUpdatedLabel}</p>
          </CardHeader>
          <CardContent className="prose max-w-none space-y-5 dark:prose-invert">
            <section>
              <h2 className="text-xl font-semibold">1. Qué cubre esta política</h2>
              <p>
                Esta política explica cómo {legalConfig.legalEntityName} trata datos personales dentro de la plataforma {legalConfig.productName},
                incluyendo cuentas de usuario, organizaciones, búsqueda y enriquecimiento de leads, envíos de correo, seguimiento de interacciones,
                automatizaciones comerciales y funciones asociadas a la extensión de navegador cuando el usuario decide utilizarla.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold">2. Qué datos podemos tratar</h2>
              <ul className="list-disc pl-5">
                <li>Datos de cuenta y acceso: nombre, correo, organización, rol y metadatos de sesión.</li>
                <li>Datos de leads y prospectos: nombre, cargo, empresa, correo laboral, teléfono, LinkedIn, ubicación y notas comerciales.</li>
                <li>Datos de actividad comercial: correos enviados, aperturas, clics, respuestas, estados de entrega y exclusiones de contacto.</li>
                <li>Datos de integraciones: identificadores técnicos y tokens necesarios para conectar Gmail, Outlook u otros proveedores autorizados.</li>
                <li>Datos operativos y de seguridad: logs, auditoría, identificadores técnicos y eventos necesarios para proteger la plataforma.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold">3. Para qué usamos estos datos</h2>
              <ul className="list-disc pl-5">
                <li>Crear y administrar cuentas, sesiones, organizaciones y permisos de acceso.</li>
                <li>Permitir la búsqueda, organización, enriquecimiento y seguimiento comercial de leads y oportunidades.</li>
                <li>Enviar correos y registrar eventos necesarios para medir entregabilidad, respuesta y bajas.</li>
                <li>Ejecutar automatizaciones, recomendaciones, scoring y funciones asistidas por IA dentro del producto.</li>
                <li>Prevenir abuso, asegurar la plataforma, auditar acciones y resolver incidentes técnicos o de seguridad.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold">4. De dónde pueden venir los datos</h2>
              <ul className="list-disc pl-5">
                <li>Directamente del usuario o de su organización al usar la plataforma.</li>
                <li>De integraciones autorizadas por el propio usuario.</li>
                <li>De fuentes públicas o de proveedores de datos y enriquecimiento activados por la organización usuaria.</li>
                <li>De respuestas e interacciones generadas dentro de las campañas o flujos de contacto.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold">5. Con quién podemos compartir datos</h2>
              <p>
                Podemos trabajar con proveedores de infraestructura, autenticación, correo, IA, analítica, búsqueda o enriquecimiento de datos.
                Compartimos datos solo cuando es necesario para operar la funcionalidad solicitada, mantener la seguridad del servicio o cumplir obligaciones legales.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold">6. Transferencias internacionales</h2>
              <p>
                Algunos proveedores pueden procesar datos fuera de Chile. Cuando eso ocurra, buscamos operar con proveedores y condiciones contractuales que entreguen un nivel razonable de resguardo,
                acorde al tipo de servicio prestado y al riesgo de los datos involucrados.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold">7. Conservación y bajas</h2>
              <ul className="list-disc pl-5">
                <li>Conservamos datos de cuenta mientras exista una relación activa con la plataforma o mientras sean necesarios para operar el servicio.</li>
                <li>Las listas de baja y exclusiones de contacto pueden mantenerse para evitar nuevos envíos no deseados.</li>
                <li>Los tokens e integraciones se conservan mientras el usuario mantenga la conexión activa o hasta su revocación.</li>
                <li>Los registros operativos y de auditoría se mantienen por el tiempo razonablemente necesario para soporte, seguridad y trazabilidad.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold">8. Derechos del titular</h2>
              <p>
                El titular puede solicitar acceso, rectificación, supresión, oposición, portabilidad o bloqueo de sus datos en los casos que permita la ley aplicable.
                Si recibiste un correo enviado desde {legalConfig.productName}, también puedes ejercer baja u oposición comercial usando el enlace incluido en ese mensaje.
              </p>
              <p>
                {contactEmail ? (
                  <>
                    Para consultas o solicitudes de privacidad, escríbenos a{' '}
                    <a href={`mailto:${contactEmail}`}>{contactEmail}</a> o usa el formulario de{' '}
                    <Link href="/privacy/request">solicitud de derechos</Link>.
                  </>
                ) : (
                  <>
                    Utiliza el canal oficial de soporte habilitado por ANTON.IA o el formulario de <Link href="/privacy/request">solicitud de derechos</Link>.
                  </>
                )}
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold">9. Seguridad</h2>
              <p>
                Aplicamos controles técnicos y organizativos razonables para proteger credenciales, sesiones, integraciones, datos operativos y registros de actividad.
                Ninguna medida de seguridad es absoluta, pero trabajamos para limitar accesos no autorizados, exposicion innecesaria y uso indebido de la información.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold">10. Automatización, IA y scoring</h2>
              <p>
                La plataforma puede usar reglas, scoring comercial y funciones asistidas por IA para priorizar leads, redactar contenido o recomendar acciones.
                Estas funciones buscan apoyar el trabajo comercial y operativo, y pueden ajustarse o deshabilitarse según la configuracion del producto o de cada organización.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold">11. Cambios a esta política</h2>
              <p>
                Podemos actualizar esta política para reflejar cambios del producto, del marco legal o de nuestros proveedores.
                Cuando los cambios sean relevantes, actualizaremos esta página con una nueva fecha de vigencia.
              </p>
            </section>
          </CardContent>
        </Card>

        <div className="mt-8 text-center text-sm text-muted-foreground">
          &copy; {new Date().getFullYear()} {legalConfig.productName}. Todos los derechos reservados.
        </div>
      </div>
    </main>
  );
}
