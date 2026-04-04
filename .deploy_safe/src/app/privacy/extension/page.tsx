
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft } from 'lucide-react';

export default function ExtensionPrivacyPolicy() {
    return (
        <div className="min-h-screen bg-background py-10 px-4 md:px-10 max-w-4xl mx-auto">
            <div className="mb-6">
                <Link href="/">
                    <Button variant="ghost" className="gap-2">
                        <ArrowLeft className="h-4 w-4" />
                        Volver a inicio
                    </Button>
                </Link>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="text-3xl font-bold">Política de Privacidad - Anton.IA Automation</CardTitle>
                    <p className="text-muted-foreground w-full">Última actualización: 16 de Diciembre de 2025</p>
                </CardHeader>
                <CardContent className="prose dark:prose-invert max-w-none space-y-4">
                    <section>
                        <h3 className="text-xl font-semibold">1. Introducción</h3>
                        <p>
                            La extensión de navegador <strong>Anton.IA Automation</strong> está diseñada para complementar la plataforma Anton.IA,
                            permitiendo la automatización de tareas en LinkedIn™ directamente desde el navegador del usuario.
                            Respetamos su privacidad y nos comprometemos a proteger los pocos datos que procesamos.
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
                                <strong>Autenticación:</strong> Almacena localmente (usando <code>chrome.storage</code>) un token temporal
                                para verificar que el usuario tiene una sesión activa en la aplicación web Anton.IA.
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
                        </ul>
                    </section>

                    <section>
                        <h3 className="text-xl font-semibold">3. Permisos Requeridos</h3>
                        <p>La extensión solicita los siguientes permisos mínimos necesarios para su operación:</p>
                        <ul className="list-disc pl-5">
                            <li><code>activeTab</code> / <code>tabs</code>: Para detectar si el usuario se encuentra en una página de LinkedIn™ válida y leer la URL actual.</li>
                            <li><code>scripting</code>: Para inyectar scripts de automatización que permiten leer datos públicos del perfil o realizar acciones solicitadas por el usuario (ej. enviar mensaje).</li>
                            <li><code>storage</code>: Para almacenar preferencias locales y el estado de la sesión (token de autenticación temporal).</li>
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
                            Toda la comunicación entre la extensión y la aplicación Anton.IA ocurre de manera local (vía <code>window.postMessage</code>)
                            o a través de canales seguros verificados. No rastreamos su historial de navegación fuera de los dominios estrictamente necesarios para la funcionalidad.
                        </p>
                    </section>

                    <section>
                        <h3 className="text-xl font-semibold">6. Contacto</h3>
                        <p>
                            Para cualquier duda sobre esta política o el funcionamiento de la extensión, puede contactar al desarrollador o administrador
                            de su instancia de Anton.IA.
                        </p>
                    </section>
                </CardContent>
            </Card>

            <div className="mt-8 text-center text-sm text-muted-foreground">
                &copy; {new Date().getFullYear()} Anton.IA. Todos los derechos reservados.
            </div>
        </div>
    );
}
