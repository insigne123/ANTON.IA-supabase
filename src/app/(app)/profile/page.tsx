"use client";

import React, { useState, useEffect } from 'react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { companyProfile as initialProfile } from '@/lib/data';
import { Save, Sparkles } from 'lucide-react';
import { generateCompanyProfile, GenerateCompanyProfileOutput } from '@/ai/flows/generate-company-profile';
import { useToast } from '@/hooks/use-toast';

import { profileService } from '@/lib/services/profile-service';

export default function ProfilePage() {
  const [profile, setProfile] = useState({
    name: '',
    role: '',
    companyName: '',
    sector: '',
    website: '',
    description: '',
    services: '',
    valueProposition: '',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    async function loadProfile() {
      try {
        const data = await profileService.getProfile();
        if (data) {
          const extended = data.signatures?.['profile_extended'] || {};
          setProfile({
            name: data.full_name || '',
            role: data.job_title || extended.role || '',
            companyName: data.company_name || '',
            sector: extended.sector || '',
            website: data.company_domain || '',
            description: extended.description || '',
            services: extended.services || '',
            valueProposition: extended.valueProposition || '',
          });
        } else {
          // Set initial state from data file if nothing is saved
          setProfile(prev => ({
            ...prev,
            companyName: initialProfile.name,
            sector: initialProfile.sector,
            website: initialProfile.website,
            description: initialProfile.description,
            services: initialProfile.services,
            valueProposition: initialProfile.valueProposition,
          }));
        }
      } catch (e) {
        console.error('Error loading profile:', e);
      }
    }
    loadProfile();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const currentProfile = await profileService.getProfile();
      const currentSignatures = currentProfile?.signatures || {};

      await profileService.updateProfile({
        full_name: profile.name,
        company_name: profile.companyName,
        company_domain: profile.website,
        job_title: profile.role,
        signatures: {
          ...currentSignatures,
          profile_extended: {
            role: profile.role,
            sector: profile.sector,
            description: profile.description,
            services: profile.services,
            valueProposition: profile.valueProposition
          }
        }
      });

      toast({
        title: "Perfil Guardado",
        description: "La información de tu empresa ha sido actualizada en la nube.",
      });
    } catch (error) {
      console.error('Error saving profile:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "No se pudo guardar el perfil.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleAutofill = async () => {
    if (!profile.companyName) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Por favor, introduce el nombre de la empresa para autocompletar.",
      });
      return;
    }
    setIsGenerating(true);
    try {
      const result: GenerateCompanyProfileOutput = await generateCompanyProfile({ companyName: profile.companyName });
      setProfile(prev => ({
        ...prev,
        sector: result.sector,
        website: result.website,
        description: result.description,
        services: result.services,
        valueProposition: result.valueProposition,
      }));
      toast({
        title: "¡Información Autocompletada!",
        description: "Hemos rellenado el perfil de tu empresa con IA.",
      });
    } catch (error) {
      console.error("Error generating company profile:", error);
      toast({
        variant: "destructive",
        title: "Error de Autocompletado",
        description: "No se pudo generar la información. Por favor, inténtalo de nuevo.",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { id, value } = e.target;
    setProfile(prev => ({ ...prev, [id]: value }));
  }

  return (
    <div className="container mx-auto py-2">
      <PageHeader
        title="Mi Perfil de Empresa"
        description="Configura la información de tu empresa para personalizar la comunicación con tus leads."
      />
      <Card>
        <CardHeader>
          <CardTitle>Información de la Empresa</CardTitle>
          <CardDescription>Estos datos se usarán para representar a tu empresa. Introduce el nombre y pulsa el botón de autocompletar.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Nombre</Label>
              <Input id="name" value={profile.name} onChange={handleInputChange} placeholder="Ej: John Doe" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">Cargo</Label>
              <Input id="role" value={profile.role} onChange={handleInputChange} placeholder="Ej: Director de Ventas" />
            </div>
          </div>
          <div className="relative">
            <Label htmlFor="companyName">Nombre de la empresa</Label>
            <Input id="companyName" value={profile.companyName} onChange={handleInputChange} placeholder="Ej: Innovatech Solutions" />
            <Button variant="outline" size="sm" className="absolute bottom-1 right-1 h-8" onClick={handleAutofill} disabled={isGenerating}>
              <Sparkles className="mr-2 h-4 w-4" />
              {isGenerating ? 'Autocompletando...' : 'Autocompletar con IA'}
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="sector">Sector/Industria</Label>
              <Input id="sector" value={profile.sector} onChange={handleInputChange} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="website">Sitio web</Label>
              <Input id="website" value={profile.website} onChange={handleInputChange} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Descripción de empresa</Label>
            <Textarea id="description" value={profile.description} onChange={handleInputChange} className="min-h-[100px]" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="services">Servicios que ofrece</Label>
            <Textarea id="services" value={profile.services} onChange={handleInputChange} className="min-h-[100px]" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="valueProposition">Value proposition</Label>
            <Textarea id="valueProposition" value={profile.valueProposition} onChange={handleInputChange} className="min-h-[100px]" />
          </div>
        </CardContent>
      </Card>

      <div className="mt-8 flex justify-end">
        <Button onClick={handleSave} disabled={isSaving}>
          <Save className="mr-2" />
          {isSaving ? 'Guardando...' : 'Guardar Perfil'}
        </Button>
      </div>
    </div>
  );
}
