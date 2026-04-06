
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { legalConfig } from '@/lib/legal-config';

export default function ExtensionPrivacyPolicy() {
    const contactEmail = legalConfig.privacyContactEmail;

    return (
        <div className="min-h-screen bg-background py-10 px-4 md:px-10 max-w-4xl mx-auto">
            <div className="mb-6">
                <Link href="/privacy">
                    <Button variant="ghost" className="gap-2">
                        <ArrowLeft className="h-4 w-4" />
                        Volver a privacidad general
                    </Button>
                </Link>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="text-3xl font-bold">Política de Privacidad - Anton.IA Automation</CardTitle>
                    <p className="text-muted-foreground w-full">Ultima actualizacion: {legalConfig.lastUpdatedLabel}</p>
                </CardHeader>
                <CardContent className="prose dark:prose-invert max-w-none space-y-4">
                    <section>
                        <h3 className="text-xl font-semibold">1. Introducción</h3>
                        <p>
                            La extensión de navegador <strong>Anton.IA Automation</strong> está diseñada para complementar la plataforma Anton.IA,
                            permitiendo la automatización de tareas en LinkedIn™ directamente desde el navegador del usuario.
                            Esta extension no opera como un servicio independiente: solo funciona cuando el usuario decide usarla junto con la app web.
                        </p>
                    </section>

                    <section>
                        <h3 className="text-xl font-semibold">2. Recopilación y Uso de Datos</h3>
                        <p>
                            La extensión <strong>NO recopila, vende ni transfiere</strong> datos personales a terceros con fines comerciales o publicitarios.
                            Su funcionamiento se limita a:
                        </p>
                        <ul className="list-disc pl-5">
                            <li>
                                <strong>Comunicacion con la app:</strong> recibe solicitudes desde la pestana de la aplicacion web Anton.IA y reenvia respuestas del flujo de automatizacion al mismo navegador.
                            </li>
                            <li>
                                <strong>Automatización (Scripting):</strong> Inyecta scripts en pestañas de LinkedIn™ <strong>exclusivamente</strong> cuando el usuario
                                solicita una acción (como "Enviar Mensaje" o "Extraer Perfil") desde la interfaz de Anton.IA.
                            </li>
                            <li>
                                <strong>Datos de Perfiles:</strong> Extrae información pública visible en la pantalla (Nombre, Título, Empresa) solo cuando el usuario
                                ejecuta explícitamente la función de "Lectura de Perfil" o "Investigación". Estos datos se envían directamente a la base de datos
                                del propio usuario en Anton.IA y no son accesibles por nosotros.
                            </li>
                            <li>
                                <strong>Eventos de respuesta:</strong> Cuando el usuario usa el monitoreo de conversaciones en LinkedIn™, la extension puede detectar el ultimo mensaje visible de un hilo y reenviarlo a la app para mantener actualizado el seguimiento comercial.
                            </li>
                        </ul>
                    </section>

                    <section>
                        <h3 className="text-xl font-semibold">3. Permisos Requeridos</h3>
                        <p>La extensión solicita los siguientes permisos mínimos necesarios para su operación:</p>
                        <ul className="list-disc pl-5">
                            <li><code>activeTab</code> / <code>tabs</code>: Para detectar si el usuario se encuentra en una página de LinkedIn™ válida y leer la URL actual.</li>
                            <li><code>scripting</code>: Para inyectar scripts de automatización que permiten leer datos públicos del perfil o realizar acciones solicitadas por el usuario (ej. enviar mensaje).</li>
                            <li><code>host_permissions</code>: Acceso limitado a <code>www.linkedin.com</code> para la automatización y a los dominios de la aplicación Anton.IA para la comunicación segura.</li>
                        </ul>
                    </section>

                    <section>
                        <h3 className="text-xl font-semibold">4. Uso de Datos (Google User Data Policy)</h3>
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
                        <h3 className="text-xl font-semibold">5. Seguridad</h3>
                        <p>
                            La extension solo opera sobre dominios necesarios para su funcionamiento y no rastrea la navegacion del usuario fuera de esos contextos.
                            La comunicacion con la aplicacion Anton.IA se limita a la pestana activa del navegador y a los canales internos de la extension.
                        </p>
                    </section>

                    <section>
                        <h3 className="text-xl font-semibold">6. Contacto</h3>
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
        </div>
    );
}
