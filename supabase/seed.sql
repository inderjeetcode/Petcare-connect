-- ==============================================================================
-- PET CONNECT VETERINARY HEALTHCARE PLATFORM
-- Realistic Demonstration Data Seeding Script (PostgreSQL / Supabase)
-- File: supabase/seed.sql
-- ==============================================================================

-- 1. Profiles
INSERT INTO public.profiles (id, full_name, email, phone, avatar_url)
VALUES
  ('c1000000-0000-0000-0000-000000000001', 'Sarah Jenkins', 'sarah.jenkins@example.com', '+1 (555) 234-8901', 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150'),
  ('d1000000-0000-0000-0000-000000000001', 'Dr. Marcus Vance', 'm.vance@petconnect.health', '+1 (555) 789-1020', 'https://images.unsplash.com/photo-1622253692010-333f2da6031d?w=150'),
  ('d2000000-0000-0000-0000-000000000002', 'Dr. Elena Rostova', 'e.rostova@petconnect.health', '+1 (555) 345-6712', 'https://images.unsplash.com/photo-1594824813689-536098bdfb13?w=150'),
  ('d3000000-0000-0000-0000-000000000003', 'Dr. David Chen', 'd.chen@petconnect.health', '+1 (555) 890-4321', 'https://images.unsplash.com/photo-1537368910025-700350fe46c7?w=150'),
  ('d4000000-0000-0000-0000-000000000004', 'Dr. Priya Patel', 'p.patel@petconnect.health', '+1 (555) 456-7890', 'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?w=150'),
  ('a1000000-0000-0000-0000-000000000001', 'Dr. Alistair Finch', 'admin.finch@petconnect.health', '+1 (555) 901-2345', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150')
ON CONFLICT (id) DO NOTHING;

-- 2. User Roles
INSERT INTO public.user_roles (user_id, role)
VALUES
  ('c1000000-0000-0000-0000-000000000001', 'client'),
  ('d1000000-0000-0000-0000-000000000001', 'doctor'),
  ('d2000000-0000-0000-0000-000000000002', 'doctor'),
  ('d3000000-0000-0000-0000-000000000003', 'doctor'),
  ('d4000000-0000-0000-0000-000000000004', 'doctor'),
  ('a1000000-0000-0000-0000-000000000001', 'admin')
ON CONFLICT DO NOTHING;

-- 3. Doctor Profiles
INSERT INTO public.doctor_profiles (id, user_id, qualification, specialization, experience_years, consultation_fee, bio, is_active)
VALUES
  ('70000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'BVSc & AH, MVSc (Surgery)', 'Small Animal Orthopedics & Soft Tissue Surgery', 12, 65.00, 'Board-certified veterinary surgeon focusing on canine mobility and stifle joint stabilization.', true),
  ('70000000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000002', 'DVM, PhD (Gastroenterology)', 'Feline Internal Medicine & Nutrition', 9, 50.00, 'Feline medicine specialist focusing on chronic enteropathy and trichobezoar management.', true),
  ('70000000-0000-0000-0000-000000000003', 'd3000000-0000-0000-0000-000000000003', 'DVM, Board Certified Avian', 'Avian & Exotic Animal Medicine', 7, 55.00, 'Care for parrots, reptiles, and small mammals.', true),
  ('70000000-0000-0000-0000-000000000004', 'd4000000-0000-0000-0000-000000000004', 'DVM, MSc (Dermatology)', 'Veterinary Dermatology & Allergy Care', 11, 60.00, 'Specialist in allergic dermatitis, pruritus suppression, and pododermatitis.', true)
ON CONFLICT (id) DO NOTHING;

-- 4. Pets
INSERT INTO public.pets (id, owner_id, name, species, breed, date_of_birth, gender, weight, color, allergies, medical_notes, avatar_url)
VALUES
  ('80000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'Barnaby', 'Dog', 'Golden Retriever', '2023-04-12', 'Neutered Male', 31.8, 'Warm Golden', 'Beef protein, Pollen', 'History of mild right stifle sprain; on joint supplement.', 'https://images.unsplash.com/photo-1552053831-71594a27632d?w=200'),
  ('80000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', 'Cleo', 'Cat', 'Ragdoll', '2024-02-18', 'Spayed Female', 4.3, 'Seal Point & White', 'None recorded', 'Indoor strictly; sensitive digestion.', 'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?w=200'),
  ('80000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000001', 'Pip', 'Bird', 'Lutino Cockatiel', '2025-01-05', 'Male', 0.09, 'Lemon Yellow', 'Aerosol fumes sensitive', 'Healthy flyer.', 'https://images.unsplash.com/photo-1552728089-57bdde30beb3?w=200')
ON CONFLICT (id) DO NOTHING;

-- 5. Consultations (Active, Expired, Pending)
-- Consultation 1: Active with ~5.5 days remaining
INSERT INTO public.consultations (
  id, client_id, doctor_id, pet_id, consultation_reason, consultation_status,
  activated_at, expires_at, created_at
) VALUES (
  '90000000-0000-0000-0000-000000000001',
  'c1000000-0000-0000-0000-000000000001',
  '70000000-0000-0000-0000-000000000001',
  '80000000-0000-0000-0000-000000000001',
  'Persistent limping on right hind leg after agility park run.',
  'active',
  NOW() - INTERVAL '1 day 6 hours',
  (NOW() - INTERVAL '1 day 6 hours') + INTERVAL '7 days',
  NOW() - INTERVAL '1 day 8 hours'
) ON CONFLICT (id) DO NOTHING;

-- Consultation 2: Expired 4 days ago (Read-only chat demonstration)
INSERT INTO public.consultations (
  id, client_id, doctor_id, pet_id, consultation_reason, consultation_status,
  activated_at, expires_at, created_at
) VALUES (
  '90000000-0000-0000-0000-000000000002',
  'c1000000-0000-0000-0000-000000000001',
  '70000000-0000-0000-0000-000000000004',
  '80000000-0000-0000-0000-000000000001',
  'Seasonal dermatitis and skin scratching around paws.',
  'expired',
  NOW() - INTERVAL '11 days',
  (NOW() - INTERVAL '11 days') + INTERVAL '7 days',
  NOW() - INTERVAL '12 days'
) ON CONFLICT (id) DO NOTHING;

-- 6. Prescriptions
INSERT INTO public.prescriptions (id, consultation_id, pet_id, doctor_id, client_id, diagnosis, instructions, follow_up_date)
VALUES (
  'b0000000-0000-0000-0000-000000000001',
  '90000000-0000-0000-0000-000000000001',
  '80000000-0000-0000-0000-000000000001',
  '70000000-0000-0000-0000-000000000001',
  'c1000000-0000-0000-0000-000000000001',
  'Canine Stifle Joint Strain & Mild Ligament Sprain',
  'Strict leash rest for 7 days. Administer with meals.',
  CURRENT_DATE + INTERVAL '6 days'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.prescription_items (prescription_id, medicine_name, dosage, frequency, duration, instructions)
VALUES
  ('b0000000-0000-0000-0000-000000000001', 'Carprofen 75mg Tablet', '1 tablet (75mg)', 'Once daily morning', '7 Days', 'Give with food.'),
  ('b0000000-0000-0000-0000-000000000001', 'Dasuquin Joint Supplement', '1 chewable tablet', 'Once daily', '30 Days', 'Cartilage support.')
ON CONFLICT DO NOTHING;

-- 7. Vaccinations
INSERT INTO public.vaccinations (pet_id, vaccine_name, administered_date, next_due_date, notes, administered_by)
VALUES
  ('80000000-0000-0000-0000-000000000001', 'Rabies (3-Year PureVax)', CURRENT_DATE - INTERVAL '100 days', CURRENT_DATE + INTERVAL '995 days', 'Tag #RB-9921', 'Dr. Marcus Vance'),
  ('80000000-0000-0000-0000-000000000001', 'DHPP Booster', CURRENT_DATE - INTERVAL '100 days', CURRENT_DATE + INTERVAL '265 days', 'Well tolerated', 'Dr. Marcus Vance'),
  ('80000000-0000-0000-0000-000000000002', 'FVRCP Feline Vaccine', CURRENT_DATE - INTERVAL '80 days', CURRENT_DATE + INTERVAL '285 days', 'Normal injection site', 'Dr. Elena Rostova')
ON CONFLICT DO NOTHING;
