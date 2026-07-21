import { z } from 'zod'

export const employeeCreateSchema = z.object({
	email: z.string().email(),
	firstName: z.string().min(1),
	lastName: z.string().min(1),
	middleName: z.string().optional(),
	role: z.enum(['EMPLOYEE', 'MANAGER', 'HR_ADMIN', 'SUPER_ADMIN', 'PAYROLL_OFFICER', 'FINANCE']),
	departmentId: z.string().min(1),
	jobTitle: z.string().min(1),
	employmentType: z.enum(['FULL_TIME', 'PROBATIONARY', 'CONTRACTUAL', 'PART_TIME']),
	startDate: z.coerce.date(),
	basicMonthlySalary: z.coerce.number().positive(),
	sssNumber: z.string().optional(),
	philhealthNumber: z.string().optional(),
	pagibigNumber: z.string().optional(),
	tinNumber: z.string().optional(),
	reportsToId: z.string().optional(),
	contactPhone: z.string().optional(),
	contactAddress: z.string().optional()
})

export const timesheetCreateSchema = z.object({
	periodStart: z.coerce.date(),
	periodEnd: z.coerce.date(),
	entries: z.string().optional() // JSON string of TimesheetEntry[]
})

export const leaveRequestSchema = z.object({
	leaveTypeId: z.string().min(1),
	startDate: z.coerce.date(),
	endDate: z.coerce.date(),
	reason: z.string().optional()
})

export const payrollComputeSchema = z.object({
	periodStart: z.coerce.date(),
	periodEnd: z.coerce.date()
})

export const recruitmentPostingSchema = z.object({
	title: z.string().min(1),
	description: z.string().min(1),
	requirements: z.string().optional(),
	location: z.string().optional(),
	departmentId: z.string().optional(),
	employmentType: z.enum(['FULL_TIME', 'PROBATIONARY', 'CONTRACTUAL', 'PART_TIME']).optional()
})

export const applicantSchema = z.object({
	firstName: z.string().min(1),
	lastName: z.string().min(1),
	email: z.string().email(),
	phone: z.string().optional(),
	coverLetter: z.string().optional(),
	resumeUrl: z
		.string()
		.url()
		.refine((u) => /^https?:\/\//i.test(u), 'Must be an http(s) URL')
		.optional()
})
