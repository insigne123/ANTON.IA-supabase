
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { legalConfig } from '@/lib/legal-config';

export default function ExtensionPrivacyPolicy() {
    const contactEmail = legalConfig.privacyContactEmail;

    return (
        <main className="min-h-screen bg-background py-10 px-4 md:px-10 max-w-4xl mx-auto">
            <div className="mb-6">
                <Button asChild variant="ghost" className="gap-2">
                    <Link href="/privacy">
                        <ArrowLeft className="h-4 w-4" />
                        Volver a privacidad general
                    </Link>
                </Button>
            </div>

            <Card>
                <CardHeader>
                    <h1 className="text-3xl font-bold">Política de Privacidad - Anton.IA — LinkedIn Workspace</h1>
                    <p className="text-muted-foreground w-full">Ultima actualizacion: {legalConfig.lastUpdatedLabel}</p>
                </CardHeader>
                <CardContent className="prose dark:prose-invert max-w-none space-y-4">
                    <section>
                        <h2 className="text-xl font-semibold">1. Introducción</h2>
                        <p>
                            La extensión de navegador <strong>Anton.IA — LinkedIn Workspace</strong> complementa la plataforma Anton.IA
                            desde perfiles de LinkedIn™: consulta y enriquece datos profesionales, guarda contactos en la organización del usuario,
                            solicita investigaciones, genera borradores de mensajes y permite preparar un mensaje en LinkedIn™ o enviarlo
                            automáticamente tras una confirmación explícita del usuario. También ofrece funciones compatibles de seguimiento
                            por email (secuencias y campañas) que se revisan y aprueban en la app web.
                            Esta extensión no opera como un servicio independiente: requiere una cuenta de Anton.IA y la sesión del usuario en LinkedIn™.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold">2. Recopilación y Uso de Datos</h2>
                        <p>
                            La extensión trata datos de identidad, datos profesionales, URLs de perfiles y contenido de mensajes para las acciones solicitadas.
                            Estos datos se procesan en Anton.IA y, para enriquecer, investigar o redactar, en los proveedores correspondientes de la plataforma.
                            Su funcionamiento comprende:
                        </p>
                        <ul className="list-disc pl-5">
                            <li>
                                <strong>Conexión con la app:</strong> al conectar la cuenta se abre la página de Anton.IA y el usuario confirma el vínculo.
                                La extensión conserva el vínculo de usuario y organización en el almacenamiento local, sin copiar tokens.
                                Usa la sesión de Anton.IA del navegador para consultar la app aunque su pestaña esté cerrada. Los borradores y opciones de mensajes se conservan localmente por usuario, organización y perfil, también al cerrar el navegador.
                            </li>
                            <li>
                                <strong>Enriquecimiento y guardado:</strong> la URL del perfil y los datos visibles que el usuario decide consultar se envían
                                a Anton.IA y a sus proveedores de enriquecimiento para obtener datos profesionales, que se guardan en la organización
                                del usuario cuando este lo confirma.
                            </li>
                            <li>
                                <strong>Investigación y redacción:</strong> el contexto del perfil y del lead guardado se envía a Anton.IA y a sus proveedores
                                de investigación y de generación de texto para producir informes con fuentes y borradores de mensajes. Las respuestas se
                                tratan como texto, no como código ejecutable.
                                El panel permite descargar un PDF de los resultados guardados. La descarga automática al terminar está activada
                                por defecto y puede desactivarse; requiere el panel abierto o volver al contacto. Un marcador local evita repetir
                                automáticamente la descarga de la misma investigación en ese navegador. El PDF descargado permanece en el equipo
                                del usuario aunque se desconecte o desinstale la extensión.
                            </li>
                            <li>
                                <strong>Preparar en LinkedIn™:</strong> inserta el borrador en la conversación cuyo destinatario coincide con el perfil
                                seleccionado, sin pulsar Enviar. Si el destinatario no puede confirmarse o existe un borrador previo, ofrece copiar el texto.
                            </li>
                            <li>
                                <strong>Envío automático:</strong> se solicita desde el panel conectado tras una confirmación explícita que muestra destinatario
                                y texto (máximo 1200 caracteres). Se utiliza la sesión abierta de LinkedIn, que el usuario debe comprobar antes de confirmar.
                                La extensión verifica el enlace del destinatario en la conversación y conserva los borradores existentes.
                            </li>
                            <li>
                                <strong>Confirmación e historial:</strong> Anton.IA guarda un intento con usuario, organización, contacto, texto y estado
                                antes del envío. El resultado se confirma cuando aparece un nuevo evento saliente con el texto esperado en la conversación verificada.
                                Si no puede comprobarlo, queda pendiente o incierto y no se reenvía automáticamente el mismo mensaje.
                                La extensión no convierte un mensaje directo en una invitación de conexión.
                            </li>
                            <li>
                                <strong>Sin monitoreo automático:</strong> la extensión no observa conversaciones ni recopila respuestas de LinkedIn™ en segundo plano.
                            </li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold">3. Permisos Requeridos</h2>
                        <p>La extensión solicita los siguientes permisos mínimos necesarios para su operación:</p>
                        <ul className="list-disc pl-5">
                            <li><code>tabs</code>: para identificar el perfil de LinkedIn™ abierto, abrir o reutilizar la pestaña del perfil seleccionado y gestionar la pestaña de conexión autorizada con Anton.IA.</li>
                            <li><code>sidePanel</code>: para mostrar el espacio de trabajo lateral junto al perfil de LinkedIn™.</li>
                            <li><code>storage</code>: para conservar localmente el vínculo de cuenta, los borradores y opciones de mensajes, y operaciones pendientes de sincronizar. El registro de operaciones no incluye el texto del mensaje.</li>
                            <li><code>scripting</code>: para activar los scripts incluidos en la extensión en pestañas de LinkedIn abiertas antes de instalar o actualizar.</li>
                            <li><code>host_permissions</code>: acceso limitado a <code>www.linkedin.com</code> para el contexto del perfil y el mensaje solicitado, y a los dominios de Anton.IA para ejecutar las operaciones autorizadas y devolver su confirmación.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold">4. Uso de Datos (Google User Data Policy)</h2>
                        <p>
                            De acuerdo con la política de "Limited Use" de Google Chrome Web Store:
                        </p>
                        <ul className="list-disc pl-5">
                            <li>Las transferencias a los proveedores de alojamiento, enriquecimiento, investigación y generación de texto se realizan para prestar las funciones solicitadas, conforme a la política general de Anton.IA.</li>
                            <li>La extensión <strong>no utiliza ni transfiere</strong> datos para fines de solvencia crediticia, préstamos, publicidad o minería de datos.</li>
                            <li>La extensión <strong>no vende</strong> datos de usuario.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold">5. Conservación y eliminación</h2>
                        <ul className="list-disc pl-5">
                            <li>
                                Los leads, investigaciones, borradores guardados y registros de actividad se conservan en la cuenta y organización
                                de Anton.IA según la política general de la plataforma y los derechos aplicables.
                            </li>
                            <li>
                                Desconectar la cuenta desde el panel revoca el vínculo y elimina sus datos de sesión. Los resultados locales pendientes
                                se conservan para sincronizarlos al reconectar con la misma cuenta y organización. Los registros locales sincronizados se eliminan.
                            </li>
                            <li>
                                Desinstalar la extensión no elimina automáticamente los datos ya guardados en Anton.IA: deben gestionarse desde la app
                                o mediante una solicitud de privacidad.
                            </li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold">6. Seguridad</h2>
                        <p>
                            La extension solo opera sobre dominios necesarios para su funcionamiento y no rastrea la navegacion del usuario fuera de esos contextos.
                            La pestaña de conexión autoriza el vínculo. Las consultas posteriores utilizan el worker de la extensión y la sesión de Anton.IA del navegador.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold">7. Contacto</h2>
                        <p>
                            {contactEmail ? (
                                <>
                                    Para cualquier duda sobre esta politica o el funcionamiento de la extension, puedes escribir a <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.
                                </>
                            ) : (
                                'Para cualquier duda sobre esta politica o el funcionamiento de la extension, puedes contactar al administrador de tu instancia o al canal oficial de soporte de Anton.IA.'
                            )}
                        </p>
                    </section>
                </CardContent>
            </Card>

            <div className="mt-8 text-center text-sm text-muted-foreground">
                &copy; {new Date().getFullYear()} {legalConfig.productName}. Todos los derechos reservados.
            </div>
        </main>
    );
}
