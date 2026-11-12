import type { Tool } from "../mcp/tool.js";
import { setCollectionBanner, setCourseBanner } from "./banners.js";
import { importExam, importModuleContent } from "./bulk-import.js";
import { deleteChat, getChatThread, listWaitingChats, replyChat, setChatStatus } from "./chat.js";
import { listMyClassrooms } from "./classrooms.js";
import { deleteCollection, listCollections, moveCourseToCollection, reorderCollectionCourses, saveCollection } from "./collections.js";
import { groupSales, listSales, salesFunnel, salesSummary } from "./commerce.js";
import { createLesson } from "./content.js";
import {
	createCourse,
	deleteCourse,
	deleteTheme,
	getCourse,
	listCourseThemes,
	reorderModules,
	saveTheme,
	setItemThemes,
	transferCourse,
	updateCourse
} from "./course-admin.js";
import { getCourseOutline, listCourses } from "./courses.js";
import { activateTrialCourse, decideAccessRequest, listAccessRequests } from "./enrollment.js";
import {
	deleteExam,
	deleteExamQuestion,
	deleteScenario,
	deleteScenarioCriterion,
	getExam,
	getScenario,
	saveExamQuestion,
	saveScenarioCriterion,
	updateExam,
	updateScenario
} from "./evaluation-admin.js";
import { addExamQuestions, addScenarioCriteria, createExam, createScenario } from "./evaluations.js";
import { deleteGame, getGame, saveGame } from "./games.js";
import {
	deleteFlashcard,
	deleteQuizQuestion,
	deleteSelfCheckQuestion,
	listLessonItems,
	saveFlashcard,
	saveQuizQuestion,
	saveSelfCheckQuestion
} from "./lesson-content.js";
import { addFlashcards, addQuizQuestions } from "./lesson-items.js";
import { deleteLesson, deleteModule, getLesson, getModule, reorderLessons, updateLesson, updateModule } from "./module-admin.js";
import { createModule, setPublished } from "./modules.js";
import { linkSharedModule, listSharedModules, moveSharedModule, setCourseLibrary, unlinkSharedModule } from "./shared-modules.js";
import { getGroupPricing, setGroupPricing } from "./group-pricing.js";
import { createOffer, deleteOffer, listOffers, setOfferActive, updateOffer } from "./offers.js";
import { classroomProgress } from "./progress.js";
import { getStudentDetail, listMembers, removeMember, setCourseGrants } from "./roster.js";

export const TOOLS = [
	listMyClassrooms,
	listCourses,
	getCourseOutline,
	createModule,
	createLesson,
	addQuizQuestions,
	addFlashcards,
	createExam,
	addExamQuestions,
	createScenario,
	addScenarioCriteria,
	setPublished,
	classroomProgress,
	listWaitingChats,
	replyChat,
	listAccessRequests,
	decideAccessRequest,
	activateTrialCourse,
	listOffers,
	createOffer,
	setOfferActive,
	getGroupPricing,
	setGroupPricing,
	salesSummary,
	// Carga masiva
	importExam,
	importModuleContent,
	// Cursos, colecciones y estructura
	createCourse,
	getCourse,
	updateCourse,
	deleteCourse,
	transferCourse,
	reorderModules,
	listSharedModules,
	linkSharedModule,
	unlinkSharedModule,
	moveSharedModule,
	setCourseLibrary,
	listCourseThemes,
	saveTheme,
	deleteTheme,
	setItemThemes,
	listCollections,
	saveCollection,
	deleteCollection,
	moveCourseToCollection,
	reorderCollectionCourses,
	setCourseBanner,
	setCollectionBanner,
	getModule,
	updateModule,
	deleteModule,
	reorderLessons,
	getLesson,
	updateLesson,
	deleteLesson,
	// Material de lección
	listLessonItems,
	saveQuizQuestion,
	deleteQuizQuestion,
	saveSelfCheckQuestion,
	deleteSelfCheckQuestion,
	saveFlashcard,
	deleteFlashcard,
	getGame,
	saveGame,
	deleteGame,
	// Evaluaciones
	getExam,
	updateExam,
	deleteExam,
	saveExamQuestion,
	deleteExamQuestion,
	getScenario,
	updateScenario,
	deleteScenario,
	saveScenarioCriterion,
	deleteScenarioCriterion,
	// Personas, chat y ventas
	listMembers,
	getStudentDetail,
	removeMember,
	setCourseGrants,
	getChatThread,
	setChatStatus,
	deleteChat,
	updateOffer,
	deleteOffer,
	listSales,
	salesFunnel,
	groupSales
] as unknown as readonly Tool[];
