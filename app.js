import express from 'express'
import session from 'express-session'
import cors from 'cors'
import { existsSync } from 'fs'
import setupWizard from './setup/setup.js'

if (!existsSync("./.env")) {
  await setupWizard()
}