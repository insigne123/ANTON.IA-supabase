import Link from 'next/link';
import { ArrowLeft, Shield } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { legalConfig } from '@/lib/legal-config';

export default function PrivacyPolicyPage() {
  const contactEmail = legalConfig.privacyContactEmail;

  return (
    <div className="min-h-screen bg-background px-4 py-10 md:px-10">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <Link href="/login">
            <Button variant="ghost" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Volver a acceso
            </Button>
          </Link>
          <Link href="/privacy/request">
            <Button variant="secondary" className="gap-2">
              <Shield className="h-4 w-4" />
              Solicitar derechos
            </Button>
          </Link>
          <Link href="/privacy/extension">
            <Button variant="outline" className="gap-2">
              <Shield className="h-4 w-4" />
              Ver politica de la extension
            </Button>
          </Link>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-3xl font-bold">Politica de Privacidad - Plataforma {legalConfig.productName}</CardTitle>
            <p className="text-muted-foreground">Ultima actualizacion: {legalConfig.lastUpdatedLabel}</p>
          </CardHeader>
          <CardContent className="prose max-w-none space-y-5 dark:prose-invert">
            <section>
              <h2 className="text-xl font-semibold">1. Que cubre esta politica</h2>
              <p>
                Esta politica explica como {legalConfig.legalEntityName} trata datos personales dentro de la plataforma {legalConfig.productName},
                incluyendo cuentas de usuario, organizaciones, busqueda y enriquecimiento de leads, envios de correo, seguimiento de interacciones,
                automatizaciones comerciales y funciones asociadas a la extension de navegador cuando el usuario decide utilizarla.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold">2. Que datos podemos tratar</h2>
              <ul className="list-disc pl-5">
                <li>Datos de cuenta y acceso: nombre, correo, organizacion, rol y metadatos de sesion.</li>
                <li>Datos de leads y prospectos: nombre, cargo, empresa, correo laboral, telefono, LinkedIn, ubicacion y notas comerciales.</li>
                <li>Datos de actividad comercial: correos enviados, aperturas, clics, respuestas, estados de entrega y exclusiones de contacto.</li>
                <li>Datos de integraciones: identificadores tecnicos y tokens necesarios para conectar Gmail, Outlook u otros proveedores autorizados.</li>
                <li>Datos operativos y de seguridad: logs, auditoria, identificadores tecnicos y eventos necesarios para proteger la plataforma.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold">3. Para que usamos estos datos</h2>
              <ul className="list-disc pl-5">
                <li>Crear y administrar cuentas, sesiones, organizaciones y permisos de acceso.</li>
                <li>Permitir la busqueda, organizacion, enriquecimiento y seguimiento comercial de leads y oportunidades.</li>
                <li>Enviar correos y registrar eventos necesarios para medir entregabilidad, respuesta y bajas.</li>
                <li>Ejecutar automatizaciones, recomendaciones, scoring y funciones asistidas por IA dentro del producto.</li>
                <li>Prevenir abuso, asegurar la plataforma, auditar acciones y resolver incidentes tecnicos o de seguridad.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold">4. De donde pueden venir los datos</h2>
              <ul className="list-disc pl-5">
                <li>Directamente del usuario o de su organizacion al usar la plataforma.</li>
                <li>De integraciones autorizadas por el propio usuario, como Google o Microsoft.</li>
                <li>De fuentes publicas o de proveedores de datos y enriquecimiento activados por la organizacion usuaria.</li>
                <li>De respuestas e interacciones generadas dentro de las campanas o flujos de contacto.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold">5. Con quien podemos compartir datos</h2>
              <p>
                Podemos trabajar con proveedores de infraestructura, autenticacion, correo, IA, analitica, busqueda o enriquecimiento de datos.
                Esto puede incluir servicios como Supabase, Google, Microsoft, OpenAI, n8n y otros proveedores habilitados por la organizacion usuaria.
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
              <h2 className="text-xl font-semibold">7. Conservacion y bajas</h2>
              <ul className="list-disc pl-5">
                <li>Conservamos datos de cuenta mientras exista una relacion activa con la plataforma o mientras sean necesarios para operar el servicio.</li>
                <li>Las listas de baja y exclusiones de contacto pueden mantenerse para evitar nuevos envios no deseados.</li>
                <li>Los tokens e integraciones se conservan mientras el usuario mantenga la conexion activa o hasta su revocacion.</li>
                <li>Los registros operativos y de auditoria se mantienen por el tiempo razonablemente necesario para soporte, seguridad y trazabilidad.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold">8. Derechos del titular</h2>
              <p>
                El titular puede solicitar acceso, rectificacion, supresion, oposicion, portabilidad o bloqueo de sus datos en los casos que permita la ley aplicable.
                Si recibiste un correo enviado desde {legalConfig.productName}, tambien puedes ejercer baja u oposicion comercial usando el enlace incluido en ese mensaje.
              </p>
              <p>
                {contactEmail ? (
                  <>
                    Para consultas o solicitudes de privacidad, escribenos a{' '}
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
                Aplicamos controles tecnicos y organizativos razonables para proteger credenciales, sesiones, integraciones, datos operativos y registros de actividad.
                Ninguna medida de seguridad es absoluta, pero trabajamos para limitar accesos no autorizados, exposicion innecesaria y uso indebido de la informacion.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold">10. Automatizacion, IA y scoring</h2>
              <p>
                La plataforma puede usar reglas, scoring comercial y funciones asistidas por IA para priorizar leads, redactar contenido o recomendar acciones.
                Estas funciones buscan apoyar el trabajo comercial y operativo, y pueden ajustarse o deshabilitarse segun la configuracion del producto o de cada organizacion.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold">11. Cambios a esta politica</h2>
              <p>
                Podemos actualizar esta politica para reflejar cambios del producto, del marco legal o de nuestros proveedores.
                Cuando los cambios sean relevantes, actualizaremos esta pagina con una nueva fecha de vigencia.
              </p>
            </section>
          </CardContent>
        </Card>

        <div className="mt-8 text-center text-sm text-muted-foreground">
          &copy; {new Date().getFullYear()} {legalConfig.productName}. Todos los derechos reservados.
        </div>
      </div>
    </div>
  );
}
