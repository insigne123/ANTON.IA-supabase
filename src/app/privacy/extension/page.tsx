
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
                    <h1 className="text-3xl font-bold">Política de Privacidad - Anton.IA Automation</h1>
                    <p className="text-muted-foreground w-full">Ultima actualizacion: {legalConfig.lastUpdatedLabel}</p>
                </CardHeader>
                <CardContent className="prose dark:prose-invert max-w-none space-y-4">
                    <section>
                        <h2 className="text-xl font-semibold">1. Introducción</h2>
                        <p>
                            La extensión de navegador <strong>Anton.IA Automation</strong> está diseñada para complementar la plataforma Anton.IA,
                            permitiendo la automatización de tareas en LinkedIn™ directamente desde el navegador del usuario.
                            Esta extension no opera como un servicio independiente: solo funciona cuando el usuario decide usarla junto con la app web.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold">2. Recopilación y Uso de Datos</h2>
                        <p>
                            La extensión <strong>NO recopila, vende ni transfiere</strong> datos personales a terceros con fines comerciales o publicitarios.
                            Su funcionamiento se limita a:
                        </p>
                        <ul className="list-disc pl-5">
                            <li>
                                <strong>Comunicacion con la app:</strong> recibe solicitudes desde la pestana de la aplicacion web Anton.IA y reenvia respuestas del flujo de automatizacion al mismo navegador.
                            </li>
                            <li>
                                <strong>Automatización de mensajes:</strong> Solo abre un perfil de LinkedIn™ y escribe un mensaje directo cuando el usuario revisa y confirma esa acción desde Anton.IA. La extensión no convierte un mensaje directo en una invitación de conexión.
                            </li>
                            <li>
                                <strong>Confirmación:</strong> El resultado se registra únicamente si LinkedIn™ muestra el mensaje saliente en la conversación. Si no puede confirmarlo, Anton.IA informa el error y el usuario conserva el control para revisar el hilo.
                            </li>
                            <li>
                                <strong>Sin monitoreo automático:</strong> La extensión no observa conversaciones ni recopila respuestas de LinkedIn™ en segundo plano.
                            </li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold">3. Permisos Requeridos</h2>
                        <p>La extensión solicita los siguientes permisos mínimos necesarios para su operación:</p>
                        <ul className="list-disc pl-5">
                            <li><code>tabs</code>: Para abrir o reutilizar el perfil público de LinkedIn™ seleccionado por el usuario durante un mensaje directo solicitado desde Anton.IA.</li>
                            <li><code>host_permissions</code>: Acceso limitado a <code>www.linkedin.com</code> para el mensaje directo solicitado y a los dominios de Anton.IA para recibir la acción y devolver su confirmación.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold">4. Uso de Datos (Google User Data Policy)</h2>
                        <p>
                            De acuerdo con la política de "Limited Use" de Google Chrome Web Store:
                        </p>
                        <ul className="list-disc pl-5">
                            <li>La extensión <strong>no transfiere</strong> datos del usuario a terceros, excepto para el propósito directo de la funcionalidad (guardar en su propia base de datos de Anton.IA).</li>
                            <li>La extensión <strong>no utiliza ni transfiere</strong> datos para fines de solvencia crediticia, préstamos, publicidad o minería de datos.</li>
                            <li>La extensión <strong>no vende</strong> datos de usuario.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold">5. Seguridad</h2>
                        <p>
                            La extension solo opera sobre dominios necesarios para su funcionamiento y no rastrea la navegacion del usuario fuera de esos contextos.
                            La comunicacion con la aplicacion Anton.IA se limita a la pestana activa del navegador y a los canales internos de la extension.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold">6. Contacto</h2>
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
