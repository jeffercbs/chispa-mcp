import { auditCourse, auditExam } from "./audits.js";
import { setCollectionBanner, setCourseBanner } from "./banners.js";
import { importExam, importModuleContent } from "./bulk-import.js";
import { deleteChat, getChatThread, listWaitingChats, replyChat, setChatStatus } from "./chat.js";
import { createClassroom, getClassroom, updateClassroom } from "./classroom-admin.js";
import { deleteClassroomItems, listClassroomItems, listSubmissions, saveGradeItem, saveMeeting, savePeriod, saveResource, saveSurvey, saveTask, saveTeam, setAttendance, setGrades } from "./classroom-space.js";
import { listMyClassrooms } from "./classrooms.js";
import { deleteCollection, listCollections, moveCourseToCollection, reorderCollectionCourses, saveCollection } from "./collections.js";
import { groupSales, listSales, salesFunnel, salesSummary } from "./commerce.js";
import { createLesson } from "./content.js";
import { createCourse, deleteCourse, getCourse, listCourseThemes, reorderModules, saveTheme, setItemThemes, transferCourse, updateCourse } from "./course-admin.js";
import { getCourseOutline, listCourses } from "./courses.js";
import { deleteItems, editItems } from "./edit-items.js";
import { activateTrialCourse, decideAccessRequest, listAccessRequests } from "./enrollment.js";
import { deleteExam, deleteScenario, getExam, getScenario, updateExam, updateScenario } from "./evaluation-admin.js";
import { addExamQuestions, addScenarioCriteria, createExam, createScenario } from "./evaluations.js";
import { getForumTopic, listForumTopics, replyForum, saveForumTopic } from "./forum.js";
import { getGame, saveGame } from "./games.js";
import { getGroupPricing, setGroupPricing } from "./group-pricing.js";
import { guide } from "./guide.js";
import { invitePeople, listInvites, resendInvites } from "./invites.js";
import { listLessonItems } from "./lesson-content.js";
import { addFlashcards, addQuizQuestions } from "./lesson-items.js";
import { getLesson, getModule, reorderLessons, updateLesson, updateModule } from "./module-admin.js";
import { createModule, setPublished } from "./modules.js";
import { createOffer, deleteOffer, listOffers, setOfferActive, updateOffer } from "./offers.js";
import { classroomProgress } from "./progress.js";
import { getStudentDetail, listMembers, removeMember, setCourseGrants } from "./roster.js";
import { searchContent } from "./search.js";
import { linkSharedModule, listSharedModules, moveSharedModule, setCourseLibrary, unlinkSharedModule } from "./shared-modules.js";
import { addStaff, listStaff, removeStaff, updateStaff } from "./staff.js";
export const TOOLS = [
    guide,
    listMyClassrooms,
    // Aula, equipo e invitaciones
    getClassroom,
    updateClassroom,
    createClassroom,
    listStaff,
    addStaff,
    updateStaff,
    removeStaff,
    invitePeople,
    listInvites,
    resendInvites,
    // Foro y espacio del aula
    listForumTopics,
    getForumTopic,
    saveForumTopic,
    replyForum,
    listClassroomItems,
    listSubmissions,
    saveTask,
    saveMeeting,
    saveResource,
    saveSurvey,
    savePeriod,
    saveGradeItem,
    setGrades,
    setAttendance,
    saveTeam,
    deleteClassroomItems,
    // Calidad del contenido
    auditExam,
    auditCourse,
    listCourses,
    getCourseOutline,
    searchContent,
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
    // Carga y edición masiva
    editItems,
    deleteItems,
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
    reorderLessons,
    getLesson,
    updateLesson,
    // Material de lección
    listLessonItems,
    getGame,
    saveGame,
    // Evaluaciones
    getExam,
    updateExam,
    deleteExam,
    getScenario,
    updateScenario,
    deleteScenario,
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
];
